import type { IGitClient, RawCommit } from '../interfaces/git-client.js';
import type { PathQueryOptions, SearchOptions } from '../types/query.js';
import type { Atom, AtomId, Trailers, ProtocolState } from '../types/domain.js';
import type { TrailerParser } from '../services/trailer-parser.js';
import { GIT_FILES_CHANGED_BATCH_SIZE } from '../util/constants.js';
import type { Protocol } from './protocol.js';
import type { ProtocolRegistry } from './protocol-registry.js';
import type { SearchFilter } from './search-filter.js';
import type { IAtomCache } from '../interfaces/atom-cache.js';
import type { IQueryCache } from '../interfaces/query-cache.js';
import { escapeRegex } from '../util/regex.js';

/**
 * Retrieves Atoms from git history.
 * The central query engine for all Lore-related git log queries.
 *
 * GRASP: Pure Fabrication -- persistence access abstracted from domain.
 * SOLID: DIP -- depends on IGitClient interface, not child_process.
 * GRASP: Information Expert -- knows how to map git commits to Lore domain models.
 */
export class AtomRepository {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly trailerParser: TrailerParser,
    private readonly primaryProtocol: Protocol,
    private readonly protocolRegistry: ProtocolRegistry,
    private readonly searchFilter: SearchFilter,
    private readonly atomCache: IAtomCache,
    private readonly queryCache: IQueryCache,
    private readonly isScoped: boolean = false,
  ) {}

  /**
   * Find atoms that touched the given target path/file/directory.
   * Accepts pre-resolved git log args (from PathResolver) so that
   * path resolution is the caller's responsibility (DIP).
   */
  async findByTarget(
    gitLogArgs: readonly string[],
    options: Partial<PathQueryOptions>,
    headHash?: string,
  ): Promise<Atom[]> {
    const searchOptions = this.makeDefaultSearchOptions(options);

    // 1. Try result-level query cache first if headHash provided
    if (headHash) {
      const cachedHashes = await this.queryCache.get(headHash, gitLogArgs, searchOptions);
      if (cachedHashes !== null) {
        // Query cache hit! 
        // We still need the full atom data, but we can bypass the Git log pass.
        const rawCommits = await this.gitClient.getCommitsByHashes(cachedHashes);
        const atoms = await this.parseRawCommits(rawCommits);
        
        // Return unfiltered; applying filters to cached results is redundant but safe
        // (the cache key already includes the filters).
        return atoms;
      }
    }

    // 2. Fallback to Git Discovery Pass
    const resolved = await this.resolveQueryDates(searchOptions);
    const logArgs = this.buildLogArgs(resolved);
    const allArgs = [...logArgs, ...gitLogArgs];

    if (this.isScoped && !gitLogArgs.includes('--')) {
      allArgs.push('--', '.');
    }

    const rawCommits = await this.gitClient.log(allArgs);
    const atoms = await this.parseRawCommits(rawCommits);
    const filteredAtoms = this.applyFilters(atoms, resolved);

    // 3. Persist to query cache if headHash provided
    if (headHash) {
      const hashes = filteredAtoms.map(a => a.commitHash);
      await this.queryCache.set(headHash, gitLogArgs, searchOptions, hashes);
      // Background: prune old entries
      this.queryCache.prune().catch(() => {});
    }

    return filteredAtoms;
  }

  /**
   * Find an atom by its identity key.
   * Searches across all registered protocols.
   */
  async findById(id: string, protocolName?: string): Promise<Atom | null> {
    let grepPattern: string;

    if (protocolName) {
      const protocol = this.protocolRegistry.get(protocolName);
      if (!protocol || !protocol.isValidIdentity(id)) return null;
      grepPattern = protocol.getIdentityPattern(id);
    } else {
      const patterns = this.protocolRegistry
        .all()
        .filter((p) => p.isValidIdentity(id))
        .map((p) => p.getIdentityPattern(id));

      if (patterns.length === 0) return null;
      
      if (patterns.length === 1) {
        grepPattern = patterns[0];
      } else {
        grepPattern = patterns.map((p) => `(${p})`).join('|');
      }
    }

    const logArgs = [
      '--all',
      '--extended-regexp',
      '--all-match',
      `--grep=${grepPattern}`,
    ];
    if (this.isScoped) {
      logArgs.push('--', '.');
    }
    const rawCommits = await this.gitClient.log(logArgs);
    const atoms = await this.parseRawCommits(rawCommits);

    if (atoms.length === 0) return null;

    // Precise check: find the one that actually matches this ID in any of its protocol states
    return (
      atoms.find((atom) =>
        Array.from(atom.protocols.values()).some(
          (state) => (state.trailers[state.identityKey] || [])[0] === id,
        ),
      ) ?? null
    );
  }

  /**
   * Find a single atom by its git commit hash.
   * Fetches the commit via `git log -1 <hash>` and parses it.
   * Returns null if the commit has no valid Lore trailers.
   */
  async findByCommitHash(hash: string): Promise<Atom | null> {
    const logArgs = ['-1', hash];
    if (this.isScoped) {
      logArgs.push('--', '.');
    }
    const rawCommits = await this.gitClient.log(logArgs);
    const atoms = await this.parseRawCommits(rawCommits);
    return atoms.length > 0 ? atoms[0] : null;
  }

  /**
   * Find atoms within a git revision range (e.g., "main..HEAD").
   * Passes the range directly to git log.
   */
  async findByRange(range: string): Promise<Atom[]> {
    const logArgs = [range];
    if (this.isScoped) {
      logArgs.push('--', '.');
    }
    const rawCommits = await this.gitClient.log(logArgs);
    return this.parseRawCommits(rawCommits);
  }

  /**
   * Find Lore atoms across the entire repository.
   *
   * Uses "Atom Discovery Mode" to push filters (Lore-id, author, scope, enums) down to
   * the Git layer for optimized performance on large repositories.
   */
  async findAll(options: Partial<SearchOptions> = {}, headHash?: string): Promise<Atom[]> {
    return this.findByTarget([], options, headHash);
  }

  /**
   * Find atoms matching a conventional commit scope.
   * Parses the subject line to extract scope from `type(scope): description`.
   */
  async findByScope(scope: string, options: Partial<PathQueryOptions>, headHash?: string): Promise<Atom[]> {
    return this.findByTarget([], { ...options, scope }, headHash);
  }

  /**
   * Transitively resolve follow links (Related, Supersedes, Depends-on)
   * from the given atoms using BFS up to maxDepth.
   */
  async resolveFollowLinks(atoms: readonly Atom[], maxDepth: number): Promise<Atom[]> {
    if (maxDepth <= 0 || atoms.length === 0) {
      return [...atoms];
    }

    const collected = new Map<string, Atom>();
    for (const atom of atoms) {
      collected.set(atom.id, atom);
    }

    const queue: Array<{ id: AtomId; depth: number }> = [];

    // Seed the BFS with all reference IDs from the initial atoms
    for (const atom of atoms) {
      const refIds = this.extractReferenceIds(atom);
      for (const refId of refIds) {
        if (!collected.has(refId)) {
          queue.push({ id: refId, depth: 1 });
        }
      }
    }

    while (queue.length > 0) {
      const entry = queue.shift()!;
      if (entry.depth > maxDepth) {
        continue;
      }
      if (collected.has(entry.id)) {
        continue;
      }

      const resolved = await this.findById(entry.id);
      if (resolved === null) {
        continue;
      }

      collected.set(resolved.id, resolved);

      if (entry.depth < maxDepth) {
        const nextRefIds = this.extractReferenceIds(resolved);
        for (const refId of nextRefIds) {
          if (!collected.has(refId)) {
            queue.push({ id: refId, depth: entry.depth + 1 });
          }
        }
      }
    }

    return Array.from(collected.values());
  }

  /**
   * Resolve symbolic dates (relative, refs, ISO) into absolute JS Date objects.
   */
  private async resolveQueryDates(options: SearchOptions): Promise<SearchOptions> {
    const sinceDate = options.since ? await this.gitClient.resolveDate(options.since) : null;
    const untilDate = options.until ? await this.gitClient.resolveDate(options.until) : null;

    return {
      ...options,
      sinceDate,
      untilDate,
    };
  }

  private buildBaseLogArgs(): string[] {
    return [];
  }

  /**
   * Build git log arguments including optional filters from PathQueryOptions.
   * Uses optimized coarse discovery by pushing filters to the Git layer.
   */
  private buildLogArgs(options: SearchOptions): string[] {
    const args = this.buildBaseLogArgs();

    // 1. Core Selection (Date, Author)
    if (options.author) {
      args.push(`--author=${options.author}`);
    }
    
    // Always use ISO dates for Git filters if we have them resolved,
    // ensuring parity with the authoritative JS pass.
    if (options.sinceDate) {
      args.push(`--since=${options.sinceDate.toISOString()}`);
    } else if (options.since) {
      args.push(`--since=${options.since}`);
    }

    if (options.untilDate) {
      args.push(`--until=${options.untilDate.toISOString()}`);
    } else if (options.until) {
      args.push(`--until=${options.until}`);
    }

    if (options.maxCommits !== null && options.maxCommits > 0) {
      args.push(`--max-count=${options.maxCommits}`);
    }

    // 2. Regex Engine Setup
    args.push('--extended-regexp');
    args.push('--regexp-ignore-case');
    
    // 3. Atom Discovery Sentinel
    args.push(...this.protocolRegistry.getDiscoveryGrep());

    if (options.scope) {
      args.push(`--grep=^[a-zA-Z]+\\(${escapeRegex(options.scope)}\\)`);
    }

    if (options.has) {
      // Precise discovery: only search namespaces where the trailer is explicitly defined
      const patterns = this.protocolRegistry
        .all()
        .filter((p) => p.owns(options.has!))
        .map((p) => {
          const prefix = p.namespace ? `${p.namespace}/` : '';
          // Avoid double-prefixing if the query already includes the namespace
          const fullKey = options.has!.toLowerCase().startsWith(prefix.toLowerCase())
            ? options.has!
            : `${prefix}${options.has!}`;
          return `^${escapeRegex(fullKey)}: `;
        });

      if (patterns.length > 0) {
        const combined = patterns.map((p) => `(${p})`).join('|');
        args.push(`--grep=${combined}`);
      }
    }

    // 4. Semantic Filtering (delegated to protocols)
    const filters = options.filters || {};
    for (const protocol of this.protocolRegistry.all()) {
      args.push(...protocol.getSearchGrep(filters));
    }

    if (options.text) {
      args.push(`--grep=${escapeRegex(options.text)}`);
    }

    // 5. Conjunction logic: requires ALL specific patterns to match.
    args.push('--all-match');

    return args;
  }

  /**
   * Parse an array of RawCommit into Atom[], filtering out non-Lore commits.
   */
  private async parseRawCommits(rawCommits: readonly RawCommit[]): Promise<Atom[]> {
    // First pass: identify commits claimed by any protocol and parse their states
    const hydrationTargets: Array<{ raw: RawCommit; protocols: Map<string, ProtocolState> }> = [];

    for (const raw of rawCommits) {
      const activeProtocols = this.protocolRegistry.detect(raw.trailers);
      if (activeProtocols.length === 0) {
        continue;
      }

      // Claim Hierarchy Logic:
      // 1. Identify which trailers are present
      const rawTrailersMap = this.trailerParser.parse(raw.trailers);
      const allPresentKeys = Object.keys(rawTrailersMap);
      
      // 2. Identify keys that are "owned" by at least one registered protocol
      const ownedKeys = new Set<string>();
      for (const p of activeProtocols) {
        for (const key of allPresentKeys) {
          if (p.owns(key)) {
            ownedKeys.add(key);
          }
        }
      }

      // 3. "Unclaimed" keys are those not explicitly defined in any protocol schema
      const unclaimedKeys = new Set(
        allPresentKeys.filter(key => !ownedKeys.has(key))
      );

      // 4. Hydrate each protocol state
      const protocolMap = new Map<string, ProtocolState>();
      for (const protocol of activeProtocols) {
        // All protocols get to parse normally.
        // If a protocol is permissive, it will additionally ingest unclaimedKeys.
        protocolMap.set(protocol.name.toLowerCase(), protocol.parse(raw.trailers, unclaimedKeys));
      }

      hydrationTargets.push({ raw, protocols: protocolMap });
    }

    // Second pass: get files changed using a 2-stage strategy.
    const filesPerCommit: (readonly string[] | null)[] = await Promise.all(
      hydrationTargets.map(({ raw }) => this.atomCache.getFiles(raw.hash)),
    );

    const misses: Array<{ index: number; hash: string }> = [];
    for (let i = 0; i < filesPerCommit.length; i++) {
      if (filesPerCommit[i] === null) {
        misses.push({ index: i, hash: hydrationTargets[i].raw.hash });
      }
    }

    if (misses.length > 0) {
      const hashes = misses.map(m => m.hash);
      const filesMap = await this.gitClient.getFilesChanged(hashes);

      for (const miss of misses) {
        const files = filesMap.get(miss.hash) ?? [];
        filesPerCommit[miss.index] = files;
        this.atomCache.setFiles(miss.hash, files).catch(() => {});
      }
    }

    // Build atoms by pairing parsed protocol states with their file lists
    const atoms: Atom[] = hydrationTargets.map(({ raw, protocols }, index) =>
      this.buildAtom(raw, protocols, filesPerCommit[index]!),
    );

    return atoms;
  }

  private buildAtom(raw: RawCommit, protocols: Map<string, ProtocolState>, filesChanged: readonly string[]): Atom {
    // Compatibility layer: resolve the primary ID from the root or first protocol
    const rootProtocol = this.protocolRegistry.getRoot() || this.protocolRegistry.all()[0] || this.primaryProtocol;
    const primaryState = protocols.get(rootProtocol.name.toLowerCase());
    const id = primaryState?.trailers[primaryState.identityKey]?.[0] ?? '';

    return {
      commitHash: raw.hash,
      date: new Date(raw.date),
      author: raw.author,
      intent: raw.subject,
      body: this.stripTrailersFromBody(raw.body, raw.trailers),
      protocols,
      filesChanged,
      id,
    };
  }

  /**
   * Strip the trailer block from the body text.
   * Git's %b includes trailers; %(trailers) gives them separately.
   * We remove the trailer text from the body to avoid duplication.
   */
  private stripTrailersFromBody(body: string, trailersRaw: string): string {
    if (!trailersRaw.trim()) return body;

    // The trailers appear as the last paragraph of the body.
    // Find and remove them by looking for the trailer lines at the end.
    const trailerLines = trailersRaw.trim().split('\n');
    if (trailerLines.length === 0) return body;

    // Try to find the first trailer line in the body and strip from there
    const firstTrailerLine = trailerLines[0].trim();
    const idx = body.lastIndexOf(firstTrailerLine);
    if (idx >= 0) {
      return body.slice(0, idx).trim();
    }

    return body;
  }

  /**
   * Apply post-query filters (author, since) that weren't handled at the git level.
   * Note: author and since are also passed to git log, but this provides a second
   * layer of filtering for edge cases and absolute precision.
   */
  private applyFilters(atoms: Atom[], options: SearchOptions): Atom[] {
    return this.searchFilter.applyFilters(atoms, options);
  }

  /**
   * Create a complete SearchOptions object from partial overrides.
   */
  private makeDefaultSearchOptions(overrides: Partial<SearchOptions> = {}): SearchOptions {
    return {
      scope: null,
      follow: false,
      all: false,
      author: null,
      limit: null,
      page: null,
      maxCommits: null,
      since: null,
      until: null,
      has: null,
      text: null,
      filters: {},
      ...overrides,
    };
  }

  /**
   * Create a complete PathQueryOptions object from partial overrides.
   */
  private makeDefaultOptions(overrides: Partial<PathQueryOptions> = {}): PathQueryOptions {
    return {
      scope: null,
      follow: false,
      all: false,
      author: null,
      limit: null,
      page: null,
      maxCommits: null,
      since: null,
      until: null,
      ...overrides,
    };
  }

  /**
   * Extract the scope from a conventional commit subject line.
   * Pattern: `type(scope): description`
   * Returns null if no scope is found.
   */
  private extractScope(subject: string): string | null {
    const match = subject.match(/^[a-zA-Z]+\(([^)]+)\)/);
    return match ? match[1] : null;
  }

  /**
   * Extract all referenced IDs from the trailers of all protocols in the atom.
   * (Supersedes, Depends-on, Related).
   */
  private extractReferenceIds(atom: Atom): AtomId[] {
    const ids: AtomId[] = [];

    for (const protocol of this.protocolRegistry.all()) {
      const state = atom.protocols.get(protocol.name.toLowerCase());
      if (!state) continue;

      const refKeys = protocol.getReferenceKeys();

      for (const key of refKeys) {
        const values = state.trailers[key] as readonly AtomId[];
        if (!values) continue;
        for (const id of values) {
          if (protocol.isValidIdentity(id)) {
            ids.push(id);
          }
        }
      }
    }

    return ids;
  }
}
