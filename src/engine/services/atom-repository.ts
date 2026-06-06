import { filterAtoms, resolveFilters } from '../core/logic/filtering.js';
// Pure Logic Modules
import { extractReferenceIds,hydrateAtoms } from '../core/logic/hydration.js';
import { getProtocolIdentity } from '../core/logic/identity.js';
import { authorizeKey } from '../core/logic/ownership.js';
import { 
    createTargetFromIdentities, 
    getCacheFingerprint, 
    isBlameTarget, 
} from '../core/logic/query-targets.js';
import { escapeRegex } from '../core/logic/regex.js';
import { resolveSupersession } from '../core/logic/supersession.js';
import { isValidProtocolIdentity } from '../core/logic/validation.js';
import type { Atom } from '../core/types/domain.js';
import type { QueryIdentity,QueryTargetAST, SearchOptions } from '../core/types/query.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IQueryCache } from '../interfaces/query-cache.js';
import { getIdentityPattern } from '../shell/git/protocol-query-adapter.js';
import { GLOBAL_NAMESPACE } from '../util/constants.js';
import { ProtocolError } from '../util/errors.js';
import { ProtocolRegistry } from './protocol-registry.js';


/**
 * Retrieves Atoms from git history.
 * The central query engine for all protocol-related git log queries.
 * 
 * SRP: Focused on Git history I/O and query orchestration.
 */
export class AtomRepository {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly protocolRegistry: ProtocolRegistry,
    private readonly queryCache: IQueryCache,
    private readonly baseTarget: QueryTargetAST,
  ) {}

  /**
   * HIGH-LEVEL: The primary entry point for chronological atom discovery.
   * Unifies path-scoped, multi-path, ID-based, and global history queries.
   */
  async find(target?: QueryTargetAST, options: SearchOptions = {}): Promise<Atom[]> {
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
      return this.find(createTargetFromIdentities(identities), options);
  }

  /**
   * Find atoms by a git revision range.
   */
  async findByRange(range: string, options: SearchOptions = {}): Promise<Atom[]> {
      // Range queries are currently handled as a physical path scan with a ref restriction.
      const rawCommits = await this.gitClient.log([range, ...this.baseTarget.resolvedPaths]);
      const atoms = hydrateAtoms(rawCommits, this.protocolRegistry);
      return this.postProcessAtoms(atoms, options);
  }

  /**
   * Find a single atom by its commit hash.
   */
  async findByCommitHash(hash: string, options: SearchOptions = {}): Promise<Atom | null> {
      const rawCommits = await this.gitClient.log(['-1', hash, ...this.baseTarget.resolvedPaths]);
      const atoms = hydrateAtoms(rawCommits, this.protocolRegistry);
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
    target: QueryTargetAST,
    options: SearchOptions,
    headHash?: string,
  ): Promise<Atom[]> {
    const resolvedOptions = await this.resolveOptions(options);

    // 1. Try Cache First (Fast Path)
    const fingerprint = getCacheFingerprint(target);
    if (headHash && resolvedOptions.cache !== false && !isBlameTarget(target) && target.type !== 'identity') {
      const cachedHashes = await this.queryCache.get(headHash, fingerprint, resolvedOptions);
      if (cachedHashes) {
        const rawCommits = await this.gitClient.getCommitsByHashes(cachedHashes);
        const atoms = hydrateAtoms(rawCommits, this.protocolRegistry);
        return this.postProcessAtoms(atoms, resolvedOptions);
      }
    }

    // 2. Initial Discovery Pass
    let initialAtoms: Atom[] = [];

    if (isBlameTarget(target)) {
        initialAtoms = await this.discoveryByBlame(target);
    } else if (target.type === 'identity') {
        initialAtoms = await this.discoveryByIdentities(target.identities || [], headHash);
    } else {
        initialAtoms = await this.discoveryByPaths(target.resolvedPaths, resolvedOptions);
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
    if (headHash && resolvedOptions.cache !== false && !isBlameTarget(target) && target.type !== 'identity') {
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
        for (const ctx of this.protocolRegistry.getAll()) {
            const authorizedKey = authorizeKey(options.has, ctx);
            if (authorizedKey) {
                const ns = ctx.def.namespace;
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
        maxCommits: options.maxCommits || undefined,
        regexPatterns,
        paths: [...paths],
    });

    const atoms = hydrateAtoms(rawCommits, this.protocolRegistry);
    return filterAtoms(atoms, options, this.protocolRegistry);
  }

  /**
   * Coarse Discovery: Search by logical identities.
   */
  private async discoveryByIdentities(identities: readonly QueryIdentity[], headHash?: string): Promise<Atom[]> {
    const results: Atom[] = [];
    const missing: QueryIdentity[] = [];

    const root = this.protocolRegistry.getByNamespace(GLOBAL_NAMESPACE);
    if (!root && identities.some(i => !i.protocol)) {
        throw new ProtocolError('Cannot resolve unqualified identity: No global protocol is registered. Please use "protocol/id" format.', 1);
    }
    const primaryProtocol = root?.def.name.toLowerCase() || '';

    // 1. Check Atomic Cache First
    if (headHash) {
        await Promise.all(identities.map(async (identity) => {
            const pName = (identity.protocol || primaryProtocol).toLowerCase();
            const fingerprint = `identity:${pName}/${identity.id}`;
            const cached = await this.queryCache.get(headHash, fingerprint, {});
            if (cached && cached.length > 0) {
                const raw = await this.gitClient.getCommitsByHashes(cached);
                const hydrated = hydrateAtoms(raw, this.protocolRegistry);
                results.push(...hydrated);
            } else {
                missing.push(identity);
            }
        }));
    } else {
        missing.push(...identities);
    }

    if (missing.length === 0) return results;

    // 2. Batch missing IDs into one Git query
    const patterns: string[] = [];
    for (const { id, protocol: pName } of missing) {
      if (!id) continue;
      const protocols = pName ? [this.protocolRegistry.get(pName)!] : this.protocolRegistry.getAll();
      for (const ctx of protocols) {
        if (ctx && isValidProtocolIdentity(id, ctx.def)) {
            patterns.push(getIdentityPattern(id, ctx));
        }
      }
    }
    
    if (patterns.length === 0) return results;

    const rawCommits = await this.gitClient.query({
        regexPatterns: [patterns],
        paths: [...this.baseTarget.resolvedPaths]
    });

    const hydrated = hydrateAtoms(rawCommits, this.protocolRegistry);

    // 3. Match result atoms back to requested missing identities
    const foundFromGit: Atom[] = [];
    for (const { id, protocol: pName } of missing) {
        const matchingAtom = hydrated.find(a => {
            if (pName) {
                const ctx = this.protocolRegistry.get(pName);
                const state = a.protocols.get(pName.toLowerCase()) || a.protocols.get(pName);
                const foundId = getProtocolIdentity(state, ctx!);
                return foundId === id;
            }
            for (const [name, state] of a.protocols) {
                const ctx = this.protocolRegistry.get(name);
                if (ctx && getProtocolIdentity(state, ctx) === id) return true;
            }
            return false;
        });

        if (matchingAtom) {
            foundFromGit.push(matchingAtom);
            // 4. Persist Atomic Cache (Background)
            if (headHash) {
                const pNameFinal = (pName || primaryProtocol).toLowerCase();
                const fingerprint = `identity:${pNameFinal}/${id}`;
                this.queryCache.set(headHash, fingerprint, {}, [matchingAtom.commitHash]).catch(() => {});
            }
        }
    }

    return [...results, ...foundFromGit];
  }

  /**
   * Initial Discovery: Search by specific line ranges using git blame.
   */
  private async discoveryByBlame(target: QueryTargetAST): Promise<Atom[]> {
      const range = target.lineRange;
      if (!range) throw new ProtocolError(`Target "${target.raw}" is not a valid range`, 1);

      const blameLines = await this.gitClient.blame(range.file, range.start, range.end);
      if (blameLines.length === 0) return [];

      const commitHashes = Array.from(new Set(blameLines.map((l: any) => l.commitHash as string)));
      const rawCommits = await this.gitClient.getCommitsByHashes(commitHashes);
      return hydrateAtoms(rawCommits, this.protocolRegistry);
  }

  /**
   * Post-Processor: Orchestrates supersession logic and attaches it to the atoms.
   */
  private postProcessAtoms(atoms: Atom[], _options: SearchOptions): Atom[] {
    if (atoms.length === 0) return [];

    const statusMap = resolveSupersession(atoms, this.protocolRegistry);
    
    for (const atom of atoms) {
        for (const [pName, state] of atom.protocols) {
            const ctx = this.protocolRegistry.get(pName);
            if (!ctx) continue;
            
            const id = getProtocolIdentity(state, ctx);
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
    
    const localKnowledge = new Map<string, Atom>();
    const indexAtoms = (list: readonly Atom[]) => {
        const root = this.protocolRegistry.getByNamespace(GLOBAL_NAMESPACE);
        const rootName = root?.def.name.toLowerCase();

        for (const atom of list) {
            localKnowledge.set(atom.commitHash, atom);
            
            for (const [pName, state] of atom.protocols) {
                const ctx = this.protocolRegistry.get(pName);
                if (!ctx) continue;
                const id = getProtocolIdentity(state, ctx);
                if (id) {
                    localKnowledge.set(`${pName.toLowerCase()}/${id}`, atom);
                    if (pName.toLowerCase() === rootName) {
                        localKnowledge.set(id, atom); 
                    }
                }
            }
        }
    };
    indexAtoms(atoms);

    const queue: { identities: QueryIdentity[]; depth: number }[] = [
      { identities: extractReferenceIds(atoms, this.protocolRegistry), depth: 1 },
    ];

    while (queue.length > 0) {
      const { identities, depth } = queue.shift()!;
      if (depth > maxDepth || identities.length === 0) continue;

      const missingIdentities: QueryIdentity[] = [];
      const foundAtoms: Atom[] = [];

      for (const identity of identities) {
          const qualifiedId = identity.protocol 
            ? `${identity.protocol.toLowerCase()}/${identity.id}`
            : identity.id;
          
          const found = localKnowledge.get(qualifiedId);
          if (found) {
              if (!visited.has(found.commitHash)) {
                  foundAtoms.push(found);
              }
          } else {
              missingIdentities.push(identity);
          }
      }

      if (missingIdentities.length > 0) {
          const linkedAtoms = await this.findByIds(missingIdentities, { follow: false });
          foundAtoms.push(...linkedAtoms);
          indexAtoms(linkedAtoms);
      }

      const newAtoms: Atom[] = [];
      for (const atom of foundAtoms) {
        if (!visited.has(atom.commitHash)) {
          visited.add(atom.commitHash);
          newAtoms.push(atom);
          result.push(atom);
        }
      }

      if (newAtoms.length > 0) {
        queue.push({ identities: extractReferenceIds(newAtoms, this.protocolRegistry), depth: depth + 1 });
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
      : resolveFilters(options.filters || {}, this.protocolRegistry);

    if (options.since && !options.sinceDate) {
      (resolved as any).sinceDate = await this.gitClient.resolveDate(options.since);
    }
    if (options.until && !options.untilDate) {
      (resolved as any).untilDate = await this.gitClient.resolveDate(options.until);
    }
    return resolved;
  }
}
