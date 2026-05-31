import type { IGitClient } from '../interfaces/git-client.js';
import type { PathQueryOptions, SearchOptions, QueryIdentity } from '../types/query.js';
import type { Atom } from '../types/domain.js';
import { GLOBAL_CACHE_KEY } from '../util/constants.js';
import { ProtocolError } from '../util/errors.js';
import type { ProtocolRegistry } from './protocol-registry.js';
import type { SearchFilter } from './search-filter.js';
import type { PathResolver } from './path-resolver.js';
import type { IQueryCache } from '../interfaces/query-cache.js';
import { escapeRegex } from '../util/regex.js';
import type { AtomHydrator } from './atom-hydrator.js';

/**
 * Retrieves Atoms from git history.
 * The central query engine for all protocol-related git log queries.
 * 
 * DESIGN: This class is the "Discovery Orchestrator". It hides the complexity 
 * of Git query strategy and caching. It delegates hydration to the AtomHydrator.
 */
export class AtomRepository {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly hydrator: AtomHydrator,
    private readonly protocolRegistry: ProtocolRegistry,
    private readonly searchFilter: SearchFilter,
    private readonly pathResolver: PathResolver,
    private readonly queryCache: IQueryCache,
    private readonly isScoped: boolean = false,
  ) {}

  /**
   * HIGH-LEVEL: The primary entry point for chronological atom discovery.
   * Unifies path-scoped, keyword-based, and global history queries.
   */
  async find(options: SearchOptions & { target?: string | string[] } = {}): Promise<Atom[]> {
      const headHash = await this.getHeadHash();
      
      let gitLogArgs: readonly string[] = [];
      let isGlobal = true;

      // 1. Resolve path-based arguments if target provided
      const target = options.target;
      if (target) {
          if (Array.isArray(target)) {
              if (target.length > 0) {
                  gitLogArgs = this.pathResolver.toGitLogArgsMulti(target);
                  isGlobal = false;
              }
          } else if (typeof target === 'string') {
              const parsedTarget = this.pathResolver.parseTarget(target);
              gitLogArgs = this.pathResolver.toGitLogArgs(parsedTarget);
              isGlobal = false;
          }
      }

      return this.internalQuery(gitLogArgs, options, headHash, isGlobal);
  }

  /**
   * BASE: Orchestrates the coarse discovery, fine extraction, and post-filtering passes.
   */
  private async internalQuery(
    gitLogArgs: readonly string[],
    options: SearchOptions,
    headHash?: string,
    isGlobal: boolean = false,
  ): Promise<Atom[]> {
    const resolvedOptions = await this.resolveDateOptions(options);

    // 1. Try Cache First (Fast Path)
    const cacheKey = isGlobal ? [GLOBAL_CACHE_KEY] : gitLogArgs;
    if (headHash && resolvedOptions.cache !== false) {
      const cachedHashes = await this.queryCache.get(headHash, cacheKey, resolvedOptions);
      if (cachedHashes) {
        const rawCommits = await this.gitClient.getCommitsByHashes(cachedHashes);
        return this.hydrator.hydrate(rawCommits);
      }
    }

    // 2. Discovery Pass: Build optimized Git flags
    const discoveryArgs = this.protocolRegistry.getDiscoveryGrep();
    const filterArgs = this.protocolRegistry.getSearchGrep(resolvedOptions);

    const args = this.buildGitLogArgs(
        [...discoveryArgs, ...filterArgs, ...gitLogArgs, ...this.getPathScope()], 
        resolvedOptions
    );

    const rawCommits = await this.gitClient.log(args);

    // 3. Fine Extraction & Parsing Pass (Delegated)
    let atoms = await this.hydrator.hydrate(rawCommits);

    // 4. Post-filter (Authoritative pass using resolved dates)
    atoms = this.searchFilter.filter(atoms, resolvedOptions);

    // 5. Update Cache (Background)
    if (headHash && resolvedOptions.cache !== false) {
      const hashes = atoms.map(a => a.commitHash);
      this.queryCache.set(headHash, cacheKey, resolvedOptions, hashes).catch(() => {});
    }

    return atoms;
  }

  /**
   * Find atoms by specific line ranges using git blame.
   */
  async findByLineRange(target: string, options: PathQueryOptions): Promise<Atom[]> {
      const parsedTarget = this.pathResolver.parseTarget(target);
      if (parsedTarget.type !== 'line-range' || parsedTarget.lineStart === null) {
        throw new ProtocolError(`Target must be file:line or file:line-line format (got "${target}")`, 1);
      }

      const blameArgs = this.pathResolver.toGitBlameArgs(parsedTarget);
      const blameLines = await this.gitClient.blame(
        blameArgs.file,
        blameArgs.lineStart,
        blameArgs.lineEnd,
      );

      if (blameLines.length === 0) return [];

      const commitHashes = Array.from(new Set(blameLines.map(l => l.commitHash)));
      
      // Fetch commits and hydrate
      const rawCommits = await this.gitClient.getCommitsByHashes(commitHashes);
      let atoms = await this.hydrator.hydrate(rawCommits);

      // Deduplicate by primary identity
      const seenIds = new Set<string>();
      atoms = atoms.filter(a => {
          const id = this.protocolRegistry.getIdentity(a);
          if (!id || seenIds.has(id)) return false;
          seenIds.add(id);
          return true;
      });

      return atoms;
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
    const args = [`--grep=${patterns.join('|')}`, '--extended-regexp', ...this.getPathScope()];
    const rawCommits = await this.gitClient.log(args);
    const atoms = await this.hydrator.hydrate(rawCommits);
    
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
    const args = ['-1', hash, ...this.getPathScope()];
    const rawCommits = await this.gitClient.log(args);
    const atoms = await this.hydrator.hydrate(rawCommits);
    return atoms[0] || null;
  }

  /**
   * Find atoms by their identity keys.
   */
  async findByIds(identities: readonly QueryIdentity[]): Promise<Atom[]> {
    if (identities.length === 0) return [];
    
    const patterns: string[] = [];
    
    for (const { id, protocol: protocolName } of identities) {
      if (!id) continue;

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

    const args = [`--grep=${patterns.join('|')}`, '--extended-regexp', ...this.getPathScope()];
    const rawCommits = await this.gitClient.log(args);
    const atoms = await this.hydrator.hydrate(rawCommits);

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
    const args = [range, ...this.getPathScope()];
    const rawCommits = await this.gitClient.log(args);
    return this.hydrator.hydrate(rawCommits);
  }

  /**
   * Find atoms for a conventional commit scope.
   */
  async findByScope(scope: string, options: PathQueryOptions, headHash?: string): Promise<Atom[]> {
    // Conventional commit scope regex: type(scope): description
    const grepPattern = `^[a-zA-Z]+\\(${escapeRegex(scope)}\\):`;
    return this.find({ ...options, scope: grepPattern } as SearchOptions);
  }

  /**
   * Resolve BFS traversal for Related/Supersedes/Depends-on links.
   */
  async resolveFollowLinks(atoms: readonly Atom[], maxDepth: number): Promise<Atom[]> {
    const result = [...atoms];
    const visited = new Set(atoms.map((a) => a.commitHash));
    const queue: { identities: QueryIdentity[]; depth: number }[] = [
      { identities: this.hydrator.extractReferenceIds(atoms), depth: 1 },
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
        queue.push({ identities: this.hydrator.extractReferenceIds(newAtoms), depth: depth + 1 });
      }
    }

    return result;
  }

  private async getHeadHash(): Promise<string | undefined> {
    try {
      return await this.gitClient.resolveRef('HEAD');
    } catch {
      return undefined;
    }
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
   * Internal Git log argument builder.
   * Standardizes flags across all Repository queries.
   */
  private buildGitLogArgs(baseArgs: readonly string[], options: SearchOptions): string[] {
    const args: string[] = [];
    
    // 1. Author Filter
    if (options.author) {
      args.push(`--author=${escapeRegex(options.author)}`);
    }

    // 2. Date/Ref Range Filters
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

    // 3. Limit/Depth Filters
    if (options.maxCommits) {
      args.push(`--max-count=${options.maxCommits}`);
    }
    
    // 4. Discovery Block (Regex based coarse filtering)
    if (options.scope) {
      if (options.scope.startsWith('^[a-zA-Z]+\\(')) {
        args.push(`--grep=${options.scope}`);
      } else {
        args.push(`--grep=^[a-zA-Z]+\\(${escapeRegex(options.scope)}\\):`);
      }
    }
    
    // Push 'has' filter (trailer key search) down to Git Grep
    if (options.has) {
        const patterns: string[] = [];
        for (const p of this.protocolRegistry.getAll()) {
            const authorizedKey = p.authorize(options.has);
            if (authorizedKey) {
                const prefix = p.namespace ? `${p.namespace}: ` : '';
                patterns.push(`(^${prefix}${authorizedKey}: )`);
            }
        }
        if (patterns.length > 0) {
            args.push(`--grep=${patterns.join('|')}`);
        }
    }

    if (options.text) {
      args.push(`--grep=${options.text}`);
    }

    // ALWAYS use Extended Regexp and Ignore Case for protocol-aware queries
    args.push('--extended-regexp', '--regexp-ignore-case', '--all-match');

    // Add base args (might contain --)
    const separatorIndex = baseArgs.indexOf('--');
    if (separatorIndex !== -1) {
      const flags = baseArgs.slice(0, separatorIndex);
      const paths = baseArgs.slice(separatorIndex);
      // Ensure no duplicates if baseArgs already has the flags
      const finalFlags = Array.from(new Set([...args, ...flags]));
      return [...finalFlags, ...paths];
    }

    return Array.from(new Set([...args, ...baseArgs]));
  }

  private getPathScope(): string[] {
    return this.isScoped ? ['--', '.'] : [];
  }
}
