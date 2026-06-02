import type { IGitClient, RawCommit, StorageQuery } from '../interfaces/git-client.js';
import type { SearchOptions } from '../types/query.js';
import type { Atom } from '../types/domain.js';
import { GLOBAL_CACHE_KEY } from '../util/constants.js';
import { ProtocolError } from '../util/errors.js';
import type { ProtocolRegistry } from './protocol-registry.js';
import type { SearchFilter } from './search-filter.js';
import type { IQueryCache } from '../interfaces/query-cache.js';
import { FilterResolver } from './filter-resolver.js';
import { escapeRegex } from '../util/regex.js';
import type { AtomHydrator } from './atom-hydrator.js';
import type { IQueryTarget, QueryIdentity } from '../interfaces/query-target.js';
import type { SupersessionResolver } from './supersession-resolver.js';
import type { QueryTargetFactory } from './query-target-factory.js';

/**
 * Retrieves Atoms from git history.
 * The central query engine for all protocol-related git log queries.
 */
export class AtomRepository {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly hydrator: AtomHydrator,
    private readonly protocolRegistry: ProtocolRegistry,
    private readonly searchFilter: SearchFilter,
    private readonly queryCache: IQueryCache,
    private readonly baseTarget: IQueryTarget,
    private readonly supersessionResolver: SupersessionResolver,
    private readonly targetFactory: QueryTargetFactory,
  ) {}

  /**
   * HIGH-LEVEL: The primary entry point for chronological atom discovery.
   * Unifies path-scoped, multi-path, ID-based, and global history queries.
   */
  async find(target?: IQueryTarget, options: SearchOptions = {}): Promise<Atom[]> {
      const activeTarget = target || this.baseTarget;
      const headHash = await this.getHeadHash();
      return this.internalQuery(activeTarget, options, headHash);
  }

  /**
   * Find a single atom by its identity key.
   */
  async findById(identity: QueryIdentity, options: SearchOptions = {}): Promise<Atom | null> {
      const atoms = await this.findByIds([identity], options);
      return atoms[0] || null;
  }

  /**
   * Find multiple atoms by their identity keys.
   */
  async findByIds(identities: readonly QueryIdentity[], options: SearchOptions = {}): Promise<Atom[]> {
      if (identities.length === 0) return [];
      return this.find(this.targetFactory.fromIdentities(identities), options);
  }

  /**
   * Find atoms by a git revision range.
   */
  async findByRange(range: string, options: SearchOptions = {}): Promise<Atom[]> {
      // Range queries are currently handled as a physical path scan with a ref restriction.
      // This will be further unified in Phase 4.
      const rawCommits = await this.gitClient.log([range, ...this.baseTarget.getPaths()]);
      const atoms = this.hydrator.hydrate(rawCommits);
      return this.postProcessAtoms(atoms, options);
  }

  /**
   * Find a single atom by its commit hash.
   */
  async findByCommitHash(hash: string, options: SearchOptions = {}): Promise<Atom | null> {
      const rawCommits = await this.gitClient.log(['-1', hash, ...this.baseTarget.getPaths()]);
      const atoms = this.hydrator.hydrate(rawCommits);
      const processed = this.postProcessAtoms(atoms, options);
      return processed[0] || null;
  }

  /**
   * Find atoms for a conventional commit scope.
   */
  async findByScope(scope: string, options: SearchOptions): Promise<Atom[]> {
    const grepPattern = `^[a-zA-Z]+\\(${escapeRegex(scope)}\\):`;
    return this.find(this.baseTarget, { ...options, scope: grepPattern });
  }

  /**
   * BASE: Orchestrates the coarse discovery, expansion, and internalized truth pass.
   */
  private async internalQuery(
    target: IQueryTarget,
    options: SearchOptions,
    headHash?: string,
  ): Promise<Atom[]> {
    const resolvedOptions = await this.resolveOptions(options);

    // 1. Try Cache First (Fast Path)
    const fingerprint = target.getCacheFingerprint();
    if (headHash && resolvedOptions.cache !== false && !target.isBlameTarget()) {
      const cachedHashes = await this.queryCache.get(headHash, fingerprint, resolvedOptions);
      if (cachedHashes) {
        const rawCommits = await this.gitClient.getCommitsByHashes(cachedHashes);
        const atoms = this.hydrator.hydrate(rawCommits);
        return this.postProcessAtoms(atoms, resolvedOptions);
      }
    }

    // 2. Initial Discovery Pass
    let initialAtoms: Atom[] = [];

    if (target.isBlameTarget()) {
        initialAtoms = await this.discoveryByBlame(target);
    } else if (target.type === 'identity') {
        initialAtoms = await this.discoveryByIdentities(target.getIdentities());
    } else {
        initialAtoms = await this.discoveryByPaths(target.getPaths(), resolvedOptions);
    }

    // 3. Expansion Pass (Transitive Link Following)
    let expandedAtoms = initialAtoms;
    if (resolvedOptions.follow && initialAtoms.length > 0) {
        const maxDepth = resolvedOptions.maxDepth ?? 10;
        expandedAtoms = await this.resolveFollowLinks(initialAtoms, maxDepth);
    }

    // 4. Projection Pass (Internalized Truth)
    const resultAtoms = this.postProcessAtoms(expandedAtoms, resolvedOptions);

    // 5. Update Cache (Background)
    if (headHash && resolvedOptions.cache !== false && target.type !== 'identity' && !target.isBlameTarget()) {
      const hashes = resultAtoms.map(a => a.commitHash);
      this.queryCache.set(headHash, fingerprint, resolvedOptions, hashes).catch(() => {});
    }

    return resultAtoms;
  }

  /**
   * Coarse Discovery: Search by physical paths and regex patterns.
   */
  private async discoveryByPaths(paths: readonly string[], options: SearchOptions): Promise<Atom[]> {
    const regexPatterns: string[][] = [];
    
    const discoveryPatterns = this.protocolRegistry.getDiscoveryPatterns();
    if (discoveryPatterns.length > 0) regexPatterns.push(discoveryPatterns);
    
    const filterPatterns = this.protocolRegistry.getSearchPatterns(options.filters as any);
    regexPatterns.push(...filterPatterns);

    if (options.scope) {
      const pattern = options.scope.startsWith('^[a-zA-Z]+\\(') 
        ? options.scope 
        : `^[a-zA-Z]+\\(${escapeRegex(options.scope)}\\):`;
      regexPatterns.push([pattern]);
    }
    
    if (options.has) {
        const hasPatterns: string[] = [];
        for (const p of this.protocolRegistry.getAll()) {
            const authorizedKey = p.authorize(options.has);
            if (authorizedKey) {
                const ns = p.getStorageNamespace();
                const prefix = ns ? `${ns}: ` : '';
                hasPatterns.push(`^${escapeRegex(prefix)}${escapeRegex(authorizedKey)}: `);
            }
        }
        if (hasPatterns.length > 0) regexPatterns.push(hasPatterns);
    }

    if (options.text) regexPatterns.push([options.text]);

    const rawCommits = await this.gitClient.query({
        author: options.author || undefined,
        sinceDate: options.sinceDate || undefined,
        untilDate: options.untilDate || undefined,
        limit: options.maxCommits || undefined,
        regexPatterns,
        paths: [...paths],
    });

    const atoms = this.hydrator.hydrate(rawCommits);
    return this.searchFilter.filter(atoms, options);
  }

  /**
   * Coarse Discovery: Search by logical identities.
   */
  private async discoveryByIdentities(identities: readonly QueryIdentity[]): Promise<Atom[]> {
    const patterns: string[] = [];
    for (const { id, protocol: pName } of identities) {
      if (!id) continue;
      const protocols = pName ? [this.protocolRegistry.get(pName)!] : this.protocolRegistry.getAll();
      for (const p of protocols) {
        if (p?.isValidIdentity(id)) patterns.push(p.getIdentityPattern(id));
      }
    }
    
    if (patterns.length === 0) return [];

    const rawCommits = await this.gitClient.query({
        regexPatterns: [patterns],
        paths: this.baseTarget.getPaths()
    });

    const hydrated = this.hydrator.hydrate(rawCommits);

    // Strict identity matching pass
    return hydrated.filter(a => {
      for (const { id, protocol: pName } of identities) {
        if (pName) {
          const p = this.protocolRegistry.get(pName);
          if (p?.getIdentity(a.protocols.get(pName)) === id) return true;
        } else {
          for (const [name, state] of a.protocols) {
            const p = this.protocolRegistry.get(name);
            if (p?.getIdentity(state) === id) return true;
          }
        }
      }
      return false;
    });
  }

  /**
   * Initial Discovery: Search by specific line ranges using git blame.
   */
  private async discoveryByBlame(target: IQueryTarget): Promise<Atom[]> {
      const range = target.getLineRange();
      if (!range) throw new ProtocolError(`Target "${target.raw}" is not a valid line range`, 1);

      const blameLines = await this.gitClient.blame(range.file, range.start, range.end);
      if (blameLines.length === 0) return [];

      const commitHashes = Array.from(new Set(blameLines.map(l => l.commitHash)));
      const rawCommits = await this.gitClient.getCommitsByHashes(commitHashes);
      const hydratedAtoms = this.hydrator.hydrate(rawCommits);

      // Deduplicate by identity
      const seenIds = new Set<string>();
      return hydratedAtoms.filter(a => {
          const id = this.protocolRegistry.getIdentity(a);
          if (!id || seenIds.has(id)) return false;
          seenIds.add(id);
          return true;
      });
  }

  /**
   * Post-Processor: Orchestrates supersession logic and attaches it to the atoms.
   */
  private postProcessAtoms(atoms: Atom[], options: SearchOptions): Atom[] {
    if (atoms.length === 0) return [];

    const statusMap = this.supersessionResolver.resolveAll(atoms);
    
    for (const atom of atoms) {
        for (const [pName, state] of atom.protocols) {
            const protocol = this.protocolRegistry.get(pName);
            if (!protocol) continue;
            
            const id = protocol.getIdentity(state);
            const status = statusMap.get(pName.toLowerCase())?.get(id || '') as any;
            
            if (status) {
                state.supersession = {
                    superseded: status.superseded,
                    supersededBy: status.supersededBy
                };
            }
        }
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
      { identities: this.hydrator.extractReferenceIds(atoms), depth: 1 },
    ];

    while (queue.length > 0) {
      const { identities, depth } = queue.shift()!;
      if (depth > maxDepth || identities.length === 0) continue;

      const linkedAtoms = await this.findByIds(identities, { follow: false });
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
   * Resolves raw options into Engine-native objects (Dates, ASTs).
   */
  private async resolveOptions(options: SearchOptions): Promise<SearchOptions> {
    const resolved = { ...options };
    (resolved as any).filters = Array.isArray(options.filters)
      ? options.filters
      : FilterResolver.resolve(options.filters || {}, this.protocolRegistry);

    if (options.since && !options.sinceDate) {
      (resolved as any).sinceDate = await this.gitClient.resolveDate(options.since);
    }
    if (options.until && !options.untilDate) {
      (resolved as any).untilDate = await this.gitClient.resolveDate(options.until);
    }
    return resolved;
  }
}
