import type { IGitClient, RawCommit } from '../interfaces/git-client.js';
import type { PathQueryOptions, SearchOptions } from '../types/query.js';
import type { LoreAtom, LoreId, LoreTrailers } from '../types/domain.js';
import type { TrailerParser } from '../services/trailer-parser.js';
import { LORE_ID_PATTERN, GIT_FILES_CHANGED_BATCH_SIZE, LORE_ID_KEY } from '../util/constants.js';
import type { Protocol } from './protocol.js';
import type { SearchFilter } from './search-filter.js';
import type { IAtomCache } from '../interfaces/atom-cache.js';
import { escapeRegex } from '../util/regex.js';

/**
 * Retrieves LoreAtoms from git history.
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
    private readonly protocol: Protocol,
    private readonly searchFilter: SearchFilter,
    private readonly atomCache: IAtomCache,
    private readonly isScoped: boolean = false,
  ) {}

  /**
   * Find atoms that touched the given target path/file/directory.
   * Accepts pre-resolved git log args (from PathResolver) so that
   * path resolution is the caller's responsibility (DIP).
   */
  async findByTarget(gitLogArgs: readonly string[], options: PathQueryOptions): Promise<LoreAtom[]> {
    const searchOptions = this.makeDefaultSearchOptions(options);
    const resolved = await this.resolveQueryDates(searchOptions);
    const logArgs = this.buildLogArgs(resolved);
    const allArgs = [...logArgs, ...gitLogArgs];
    const rawCommits = await this.gitClient.log(allArgs);
    const atoms = await this.parseRawCommits(rawCommits);
    return this.applyFilters(atoms, resolved);
  }

  /**
   * Find an atom by its Lore-id.
   * Uses git log --grep to efficiently search for the specific trailer value
   * instead of fetching entire history.
   */
  async findByLoreId(loreId: LoreId): Promise<LoreAtom | null> {
    if (!LORE_ID_PATTERN.test(loreId)) {
      return null;
    }

    const logArgs = ['--all', '--extended-regexp', '--all-match', `--grep=^${LORE_ID_KEY}: ${escapeRegex(loreId)}`];
    if (this.isScoped) {
      logArgs.push('--', '.');
    }
    const rawCommits = await this.gitClient.log(logArgs);
    const atoms = await this.parseRawCommits(rawCommits);

    return atoms.find((atom) => atom.loreId === loreId) ?? null;
  }

  /**
   * Find a single atom by its git commit hash.
   * Fetches the commit via `git log -1 <hash>` and parses it.
   * Returns null if the commit has no valid Lore trailers.
   */
  async findByCommitHash(hash: string): Promise<LoreAtom | null> {
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
  async findByRange(range: string): Promise<LoreAtom[]> {
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
  async findAll(options: Partial<SearchOptions> = {}): Promise<LoreAtom[]> {
    const queryOptions = this.makeDefaultSearchOptions(options);
    const resolved = await this.resolveQueryDates(queryOptions);
    const args = this.buildLogArgs(resolved);

    if (this.isScoped) {
      args.push('--', '.');
    }

    const rawCommits = await this.gitClient.log(args);
    const atoms = await this.parseRawCommits(rawCommits);
    return this.applyFilters(atoms, resolved);
  }

  /**
   * Find atoms matching a conventional commit scope.
   * Parses the subject line to extract scope from `type(scope): description`.
   */
  async findByScope(scope: string, options: PathQueryOptions): Promise<LoreAtom[]> {
    const queryOptions = this.makeDefaultSearchOptions({ ...options, scope });
    const resolved = await this.resolveQueryDates(queryOptions);
    const logArgs = this.buildLogArgs(resolved);
    
    if (this.isScoped) {
      logArgs.push('--', '.');
    }

    const rawCommits = await this.gitClient.log(logArgs);
    const atoms = await this.parseRawCommits(rawCommits);
    return this.applyFilters(atoms, resolved);
  }

  /**
   * Transitively resolve follow links (Related, Supersedes, Depends-on)
   * from the given atoms using BFS up to maxDepth.
   */
  async resolveFollowLinks(atoms: readonly LoreAtom[], maxDepth: number): Promise<LoreAtom[]> {
    if (maxDepth <= 0 || atoms.length === 0) {
      return [...atoms];
    }

    const collected = new Map<string, LoreAtom>();
    for (const atom of atoms) {
      collected.set(atom.loreId, atom);
    }

    const queue: Array<{ loreId: LoreId; depth: number }> = [];

    // Seed the BFS with all reference IDs from the initial atoms
    for (const atom of atoms) {
      const refIds = this.extractReferenceIds(atom.trailers);
      for (const refId of refIds) {
        if (!collected.has(refId)) {
          queue.push({ loreId: refId, depth: 1 });
        }
      }
    }

    while (queue.length > 0) {
      const entry = queue.shift()!;
      if (entry.depth > maxDepth) {
        continue;
      }
      if (collected.has(entry.loreId)) {
        continue;
      }

      const resolved = await this.findByLoreId(entry.loreId);
      if (resolved === null) {
        continue;
      }

      collected.set(resolved.loreId, resolved);

      if (entry.depth < maxDepth) {
        const nextRefIds = this.extractReferenceIds(resolved.trailers);
        for (const refId of nextRefIds) {
          if (!collected.has(refId)) {
            queue.push({ loreId: refId, depth: entry.depth + 1 });
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
    args.push(`--grep=^${LORE_ID_KEY}: [0-9a-f]{8}`);

    if (options.scope) {
      args.push(`--grep=^[a-zA-Z]+\\(${escapeRegex(options.scope)}\\)`);
    }

    if (options.has) {
      args.push(`--grep=^${escapeRegex(options.has)}: `);
    }

    if (options.confidence) {
      args.push(`--grep=^Confidence: ${escapeRegex(options.confidence)}`);
    }

    if (options.scopeRisk) {
      args.push(`--grep=^Scope-risk: ${escapeRegex(options.scopeRisk)}`);
    }

    if (options.reversibility) {
      args.push(`--grep=^Reversibility: ${escapeRegex(options.reversibility)}`);
    }

    if (options.text) {
      args.push(`--grep=${escapeRegex(options.text)}`);
    }

    // 4. Conjunction logic: requires ALL specific patterns to match.
    args.push('--all-match');

    return args;
  }

  /**
   * Parse an array of RawCommit into LoreAtom[], filtering out non-Lore commits.
   */
  private async parseRawCommits(rawCommits: readonly RawCommit[]): Promise<LoreAtom[]> {
    // First pass: filter to Lore commits and parse trailers (synchronous work)
    const loreCommits: Array<{ raw: RawCommit; trailers: LoreTrailers }> = [];

    for (const raw of rawCommits) {
      if (!this.trailerParser.containsLoreTrailers(raw.trailers)) {
        continue;
      }

      const trailers = this.trailerParser.parse(raw.trailers);
      const loreId = trailers[LORE_ID_KEY]?.[0];
      if (!loreId || !LORE_ID_PATTERN.test(loreId)) {
        continue;
      }

      loreCommits.push({ raw, trailers });
    }

    // Second pass: get files changed using a 2-stage strategy.
    // Stage 1: Fast concurrent cache check for all identified Lore commits.
    const filesPerCommit: (readonly string[] | null)[] = await Promise.all(
      loreCommits.map(({ raw }) => this.atomCache.getFiles(raw.hash)),
    );

    const misses: Array<{ index: number; hash: string }> = [];
    for (let i = 0; i < filesPerCommit.length; i++) {
      if (filesPerCommit[i] === null) {
        misses.push({ index: i, hash: loreCommits[i].raw.hash });
      }
    }

    // Stage 2: Batched Git fetch for cache misses only (respecting concurrency limit).
    if (misses.length > 0) {
      const hashes = misses.map(m => m.hash);
      const filesMap = await this.gitClient.getFilesChanged(hashes);

      for (const miss of misses) {
        const files = filesMap.get(miss.hash) ?? [];
        filesPerCommit[miss.index] = files;
        // Background: fire-and-forget cache update
        this.atomCache.setFiles(miss.hash, files).catch(() => {});
      }
    }

    // Build atoms by pairing parsed trailers with their file lists (now guaranteed non-null)
    const atoms: LoreAtom[] = loreCommits.map(({ raw, trailers }, index) =>
      this.buildAtom(raw, trailers, filesPerCommit[index]!),
    );

    return atoms;
  }

  /**
   * Construct a LoreAtom from its constituent parts.
   * Single source of truth for RawCommit -> LoreAtom mapping.
   * GRASP: Creator -- AtomRepository owns the data needed to create atoms.
   */
  private buildAtom(raw: RawCommit, trailers: LoreTrailers, filesChanged: readonly string[]): LoreAtom {
    const loreId = trailers[LORE_ID_KEY]?.[0];
    if (!loreId) throw new Error(`${LORE_ID_KEY} missing in trailers`);

    return {
      loreId,
      commitHash: raw.hash,
      date: new Date(raw.date),
      author: raw.author,
      intent: raw.subject,
      body: this.stripTrailersFromBody(raw.body, raw.trailers),
      trailers,
      filesChanged,
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
  private applyFilters(atoms: LoreAtom[], options: SearchOptions): LoreAtom[] {
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
      maxCommits: null,
      since: null,
      until: null,
      confidence: null,
      scopeRisk: null,
      reversibility: null,
      has: null,
      text: null,
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
   * Extract all referenced Lore-ids from the reference trailers
   * (Supersedes, Depends-on, Related).
   */
  private extractReferenceIds(trailers: LoreTrailers): LoreId[] {
    const ids: LoreId[] = [];
    const refKeys = this.protocol.getReferenceKeys();

    for (const key of refKeys) {
      const values = trailers[key] as readonly LoreId[];
      if (!values) continue;
      for (const id of values) {
        if (LORE_ID_PATTERN.test(id)) {
          ids.push(id);
        }
      }
    }

    return ids;
  }
}
