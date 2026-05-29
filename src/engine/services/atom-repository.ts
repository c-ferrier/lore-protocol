import type { IGitClient, RawCommit } from '../interfaces/git-client.js';
import type { PathQueryOptions, SearchOptions, QueryIdentity } from '../types/query.js';
import type { Atom, AtomId, Trailers, ProtocolState } from '../types/domain.js';
import type { TrailerParser } from './trailer-parser.js';
import { GIT_FILES_CHANGED_BATCH_SIZE } from '../util/constants.js';
import type { IProtocol } from '../interfaces/protocol.js';
import type { ProtocolRegistry } from './protocol-registry.js';
import type { SearchFilter } from './search-filter.js';
import type { IAtomCache } from '../interfaces/atom-cache.js';
import type { IQueryCache } from '../interfaces/query-cache.js';
import { escapeRegex } from '../util/regex.js';

/**
 * Retrieves Atoms from git history.
 * The central query engine for all protocol-related git log queries.
 *
 * GRASP: Pure Fabrication -- persistence access abstracted from domain.
 * SOLID: DIP -- depends on IGitClient interface, not child_process.
 * GRASP: Information Expert -- knows how to map git commits to protocol domain models.
 */
export class AtomRepository {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly trailerParser: TrailerParser,
    private readonly protocolRegistry: ProtocolRegistry,
    private readonly searchFilter: SearchFilter,
    private readonly atomCache: IAtomCache,
    private readonly queryCache: IQueryCache,
    private readonly isScoped: boolean = false,
  ) {}


  /**
   * Find atoms Touching a specific target (file or directory).
   */
  async findByTarget(
    gitLogArgs: readonly string[],
    options: PathQueryOptions,
    headHash?: string,
  ): Promise<Atom[]> {
    // 1. Resolve date filters for authoritative pass
    const resolvedOptions = await this.resolveDateOptions(options as SearchOptions);

    // 2. Try Cache First (Fast Path)
    if (headHash && resolvedOptions.cache !== false) {
      const cachedHashes = await this.queryCache.get(headHash, gitLogArgs, resolvedOptions);
      if (cachedHashes) {
        const rawCommits = await this.gitClient.getCommitsByHashes(cachedHashes);
        return this.parseRawCommits(rawCommits);
      }
    }

    // 3. Coarse Discovery Pass: Get all commits touching the path
    const discoveryArgs = this.protocolRegistry.getSearchGrep(resolvedOptions);
    if (discoveryArgs.length > 0) {
      discoveryArgs.push('--extended-regexp', '--regexp-ignore-case', '--all-match');
    }

    const args = this.buildGitLogArgs([...discoveryArgs, ...gitLogArgs], resolvedOptions);

    const rawCommits = await this.gitClient.log(args);

    // 4. Fine Extraction & Parsing Pass
    let atoms = await this.parseRawCommits(rawCommits);

    // 5. Post-filter (Authoritative pass using resolved dates)
    atoms = this.searchFilter.filter(atoms, resolvedOptions);

    // 6. Update Cache (Background)
    if (headHash && resolvedOptions.cache !== false) {
      const hashes = atoms.map(a => a.commitHash);
      this.queryCache.set(headHash, gitLogArgs, resolvedOptions, hashes).catch(() => {});
    }

    return atoms;
  }

  /**
   * Resolve BFS traversal for Related/Supersedes/Depends-on links.
   */
  async resolveFollowLinks(atoms: readonly Atom[], maxDepth: number): Promise<Atom[]> {
    const result = [...atoms];
    const visited = new Set(atoms.map((a) => a.commitHash));
    const queue: { identities: QueryIdentity[]; depth: number }[] = [
      { identities: this.extractReferenceIds(atoms), depth: 1 },
    ];

    while (queue.length > 0) {
      const { identities, depth } = queue.shift()!;
      if (depth > maxDepth || identities.length === 0) continue;

      const linkedAtoms = await this.findByIds(identities);
      const newAtoms: Atom[] = [];

      for (const atom of linkedAtoms) {
        if (!visited.has(atom.commitHash)) {
          visited.add(atom.commitHash);
          newAtoms.push(atom);
          result.push(atom);
        }
      }

      if (newAtoms.length > 0) {
        queue.push({ identities: this.extractReferenceIds(newAtoms), depth: depth + 1 });
      }
    }

    return result;
  }

  /**
   * Find a single atom by its identity key.
   */
  async findById(identity: QueryIdentity): Promise<Atom | null> {
    const { id, protocol: protocolName } = identity;
    if (!id) return null;

    // Resolve candidate protocols
    const matchingProtocols = protocolName 
      ? [this.protocolRegistry.get(protocolName)!].filter(Boolean)
      : this.protocolRegistry.getAll().filter(p => p.isValidIdentity(id));

    if (matchingProtocols.length === 0) return null;

    // Build a combined grep for all candidate protocols
    const patterns = matchingProtocols.map(p => p.getIdentityPattern(id));
    const args = [`--grep=${patterns.join('|')}`, '--extended-regexp'];
    
    if (this.isScoped) {
      args.push('--', '.');
    }
    const rawCommits = await this.gitClient.log(args);
    const atoms = await this.parseRawCommits(rawCommits);
    
    // Verify exact ID match in any of the candidate protocol states
    for (const atom of atoms) {
      for (const p of matchingProtocols) {
        const state = atom.protocols.get(p.name.toLowerCase());
        const atomId = (state as any)?.trailers[p.identityKey]?.[0];
        if (atomId === id) {
          return atom;
        }
      }
    }
    return null;
  }

  /**
   * Find a single atom by its commit hash.
   */
  async findByCommitHash(hash: string): Promise<Atom | null> {
    const args = ['-1', hash];
    if (this.isScoped) {
      args.push('--', '.');
    }
    const rawCommits = await this.gitClient.log(args);
    const atoms = await this.parseRawCommits(rawCommits);
    return atoms[0] || null;
  }

  /**
   * Find atoms by their identity keys.
   */
  async findByIds(identities: readonly QueryIdentity[]): Promise<Atom[]> {
    if (identities.length === 0) return [];
    
    const patterns: string[] = [];
    const idSet = new Set<string>(); // For verification pass
    
    for (const { id, protocol: protocolName } of identities) {
      if (!id) continue;
      idSet.add(id);

      const candidateProtocols = protocolName
        ? [this.protocolRegistry.get(protocolName)!].filter(Boolean)
        : this.protocolRegistry.getAll();

      for (const p of candidateProtocols) {
        if (p.isValidIdentity(id)) {
          patterns.push(p.getIdentityPattern(id));
        }
      }
    }
    
    if (patterns.length === 0) return [];

    // Git log doesn't support --grep-stdin, so for large ID sets we use OR'd regex
    const args = [`--grep=${patterns.join('|')}`, '--extended-regexp'];
    if (this.isScoped) {
      args.push('--', '.');
    }
    const rawCommits = await this.gitClient.log(args);
    const atoms = await this.parseRawCommits(rawCommits);

    // Verify exact ID matches against the requested identities
    return atoms.filter(a => {
      for (const { id, protocol: protocolName } of identities) {
        if (protocolName) {
          const state = a.protocols.get(protocolName);
          const p = this.protocolRegistry.get(protocolName);
          const atomId = (state as any)?.trailers[p?.identityKey || '']?.[0];
          if (atomId === id) return true;
        } else {
          for (const [pName, state] of a.protocols) {
            const p = this.protocolRegistry.get(pName);
            const atomId = (state as any)?.trailers[p?.identityKey || '']?.[0];
            if (atomId === id) return true;
          }
        }
      }
      return false;
    });
  }

  /**
   * Find atoms by a git revision range.
   */
  async findByRange(range: string): Promise<Atom[]> {
    const args = [range];
    if (this.isScoped) {
      args.push('--', '.');
    }
    const rawCommits = await this.gitClient.log(args);
    return this.parseRawCommits(rawCommits);
  }

  /**
   * Find atoms across the entire repository.
   * 
   * Uses "Atom Discovery Mode" to push filters (identity-key, author, scope, enums) down to 
   * git grep where possible for performance.
   */
  async findAll(options: SearchOptions = {}, headHash?: string): Promise<Atom[]> {
    // 1. Resolve date filters for authoritative pass
    const resolvedOptions = await this.resolveDateOptions(options);

    // 2. Try Cache First
    if (headHash && resolvedOptions.cache !== false) {
      const cachedHashes = await this.queryCache.get(headHash, ['GLOBAL'], resolvedOptions);
      if (cachedHashes) {
        const rawCommits = await this.gitClient.getCommitsByHashes(cachedHashes);
        return this.parseRawCommits(rawCommits);
      }
    }

    // 3. Build optimized Git Discovery args
    const discoveryArgs = this.protocolRegistry.getDiscoveryGrep();
    
    // Push filters down to Git Coarse pass
    discoveryArgs.push(...this.protocolRegistry.getSearchGrep(resolvedOptions));
    
    // Add Discovery Mode control flags
    discoveryArgs.push('--extended-regexp', '--regexp-ignore-case', '--all-match');

    const args = this.buildGitLogArgs(discoveryArgs, resolvedOptions);

    if (this.isScoped) {
      // If we don't have a path separator already, add it
      if (!args.includes('--')) {
        args.push('--', '.');
      } else {
        args.push('.');
      }
    }

    const rawCommits = await this.gitClient.log(args);
    let atoms = await this.parseRawCommits(rawCommits);

    // 4. Post-filter
    atoms = this.searchFilter.filter(atoms, resolvedOptions);

    // 5. Update Cache
    if (headHash && resolvedOptions.cache !== false) {
      const hashes = atoms.map(a => a.commitHash);
      this.queryCache.set(headHash, ['GLOBAL'], resolvedOptions, hashes).catch(() => {});
    }

    return atoms;
  }

  /**
   * Find atoms for a conventional commit scope.
   */
  async findByScope(scope: string, options: PathQueryOptions, headHash?: string): Promise<Atom[]> {
    // Conventional commit scope regex: type(scope): description
    const grepPattern = `^[a-zA-Z]+\\(${escapeRegex(scope)}\\):`;
    return this.findAll({ ...options, scope: grepPattern } as SearchOptions, headHash);
  }

  /**
   * Resolve string-based dates/refs into Date objects for authoritative filtering.
   */
  private async resolveDateOptions(options: SearchOptions): Promise<SearchOptions> {
    const resolved = { ...options };

    if (options.since && !options.sinceDate) {
      (resolved as any).sinceDate = await this.gitClient.resolveDate(options.since);
    }

    if (options.until && !options.untilDate) {
      (resolved as any).untilDate = await this.gitClient.resolveDate(options.until);
    }

    return resolved;
  }

  /**
   * Parse an array of RawCommit into Atom[], filtering out non-protocol commits.
   */
  private async parseRawCommits(rawCommits: readonly RawCommit[]): Promise<Atom[]> {
    const results: Atom[] = [];
    const hashesToFetchFiles: string[] = [];

    const allProtocols = this.protocolRegistry.getAll();
    const hasProtocols = allProtocols.length > 0;

    // First pass: Filter and parse protocols
    const parsedData: Array<{ raw: RawCommit; protocols: Map<string, ProtocolState> }> = [];

    for (const raw of rawCommits) {
      const activeProtocols = this.protocolRegistry.detect(raw.trailers);
      
      // If we have protocols registered, we only care about commits they claim.
      // If NO protocols are registered, we treat EVERY commit as an atom (agnostic mode).
      if (hasProtocols && activeProtocols.length === 0) continue;

      const protocolMap = new Map<string, ProtocolState>();
      
      if (hasProtocols) {
        // Ownership resolution logic:
        const claimedKeys = this.protocolRegistry.getClaimedKeys();

        for (const p of activeProtocols) {
          protocolMap.set(p.name.toLowerCase(), p.parse(raw.trailers, claimedKeys));
        }
      }

      parsedData.push({ raw, protocols: protocolMap });
      hashesToFetchFiles.push(raw.hash);
    }

    // Second pass: Fetch files in parallel batches
    const fileMap = await this.batchFetchFiles(hashesToFetchFiles);

    // Final pass: Build Atom objects
    for (const { raw, protocols } of parsedData) {
      const files = fileMap.get(raw.hash) || [];
      results.push(this.buildAtom(raw, protocols, files));
    }

    return results;
  }

  private async batchFetchFiles(hashes: string[]): Promise<Map<string, readonly string[]>> {
    const result = new Map<string, readonly string[]>();
    
    // 1. Parallel Cache Lookup
    const cacheResults = await Promise.all(hashes.map(h => this.atomCache.get(h)));
    
    const missingHashes: string[] = [];
    for (let i = 0; i < hashes.length; i++) {
      const hash = hashes[i];
      const cached = cacheResults[i];
      if (cached) {
        result.set(hash, cached.filesChanged);
      } else {
        missingHashes.push(hash);
      }
    }

    if (missingHashes.length === 0) return result;

    // Process missing hashes in chunks
    for (let i = 0; i < missingHashes.length; i += GIT_FILES_CHANGED_BATCH_SIZE) {
      const chunk = missingHashes.slice(i, i + GIT_FILES_CHANGED_BATCH_SIZE);
      const chunkResults = await this.gitClient.getFilesChanged(chunk);
      
      for (const [hash, files] of chunkResults.entries()) {
        result.set(hash, files);
        // Background cache update
        this.atomCache.set(hash, { filesChanged: files }).catch(() => {});
      }
    }

    return result;
  }

  private buildAtom(
    raw: RawCommit,
    protocols: Map<string, ProtocolState>,
    filesChanged: readonly string[]
  ): Atom {
    return {
      commitHash: raw.hash,
      date: new Date(raw.date),
      author: raw.author,
      subject: raw.subject,
      body: this.stripTrailersFromBody(raw.body, raw.trailers),
      filesChanged,
      protocols,
    };
  }

  private extractReferenceIds(atoms: readonly Atom[]): QueryIdentity[] {
    const identities: QueryIdentity[] = [];
    const seen = new Set<string>();
    
    for (const atom of atoms) {
      for (const [pName, state] of atom.protocols) {
        const protocol = this.protocolRegistry.get(pName);
        if (!protocol) continue;

        const refKeys = protocol.getReferenceKeys();
        for (const key of refKeys) {
          const values = state.trailers[key] || [];
          for (const val of values) {
            // Qualify the identity using the registry (implicit context: current protocol)
            try {
              const identity = this.protocolRegistry.resolveIdentity(val, pName);
              const key = `${identity.protocol}/${identity.id}`;
              if (!seen.has(key)) {
                seen.add(key);
                identities.push(identity);
              }
            } catch {
              // Skip invalid references during extraction (they will be caught by validator)
            }
          }
        }
      }
    }

    return identities;
  }

  private buildGitLogArgs(baseArgs: readonly string[], options: SearchOptions): string[] {
    const args: string[] = [];
    
    // Flags must come BEFORE paths (--)
    if (options.author) {
      args.push(`--author=${escapeRegex(options.author)}`);
    }

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

    if (options.maxCommits) {
      args.push(`--max-count=${options.maxCommits}`);
    }
    
    if (options.scope) {
      // If the scope already looks like a regex pattern (e.g. from findByScope), use it as is.
      // Otherwise, assume it's a raw scope name and wrap it in the conventional commit pattern.
      if (options.scope.startsWith('^[a-zA-Z]+\\(')) {
        args.push(`--grep=${options.scope}`);
      } else {
        args.push(`--grep=^[a-zA-Z]+\\(${escapeRegex(options.scope)}\\):`);
      }
    }
    
    if (options.text) {
      args.push(`--grep=${options.text}`);
    }

    // Add base args (might contain --)
    const separatorIndex = baseArgs.indexOf('--');
    if (separatorIndex !== -1) {
      const flags = baseArgs.slice(0, separatorIndex);
      const paths = baseArgs.slice(separatorIndex);
      return [...args, ...flags, ...paths];
    }

    return [...args, ...baseArgs];
  }

  /**
   * Remove the trailer block from the commit body to avoid redundant display.
   * Only strips if the trailers are actually at the end of the body.
   */
  private stripTrailersFromBody(body: string, trailersRaw: string): string {
    if (!trailersRaw || !body) return body;

    // Normalize for comparison
    const normalizedBody = body.trim();
    
    // Create a flexible regex that handles varying whitespace and indentation
    // We break the trailers into individual lines and allow for arbitrary whitespace around them.
    const trailerLines = trailersRaw.trim().split('\n').filter(l => l.trim() !== '');
    if (trailerLines.length === 0) return body;

    const escapedLines = trailerLines.map(l => {
      const [key, ...valParts] = l.split(':');
      const val = valParts.join(':').trim();
      return `\\s*${escapeRegex(key.trim())}:\\s*${escapeRegex(val)}\\s*`;
    });

    const flexiblePattern = escapedLines.join('\n') + '\\s*$';
    
    try {
      const trailerRegex = new RegExp(flexiblePattern, 'm');
      if (trailerRegex.test(body)) {
        return body.replace(trailerRegex, '').trim();
      }
    } catch {
      // Best effort
    }

    return body;
  }
}
