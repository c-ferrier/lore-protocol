import { filterAtoms, resolveFilters,resolveFilterStrings } from '../core/logic/filtering.js';
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
import { type Atom, type SupersessionStatus } from '../core/types/domain.js';
import type { QualifiedFilter,QueryIdentity,QueryOptions,QueryTargetAST, RawFilterMap } from '../core/types/query.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IQueryCache } from '../interfaces/query-cache.js';
import { getIdentityPattern } from '../shell/git/protocol-query-adapter.js';
import { GLOBAL_NAMESPACE } from '../util/constants.js';
import { ProtocolError } from '../util/errors.js';
import { ProtocolRegistry } from './protocol-registry.js';


/**
 * Retrieves Atoms from git history.
 * Standardizes discovery across protocols by centralizing Git I/O.
 * 
 * SRP: Focused on Git history I/O and query orchestration.
 * Tier: Shell Service (Encloses physical storage)
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
  async find(target?: QueryTargetAST, options: QueryOptions = {}): Promise<Atom[]> {
      const activeTarget = target || this.baseTarget;
      const headHash = await this.getHeadHash();
      return this.internalQuery(activeTarget, options, headHash);
  }

  /**
   * Find a single atom by its identity key.
   */
  async findById(identity: QueryIdentity, options: QueryOptions = {}): Promise<Atom | null> {
      const atoms = await this.findByIds([identity], options);
      return atoms[0] || null;
  }

  /**
   * Find multiple atoms by their identity keys.
   */
  async findByIds(identities: readonly QueryIdentity[], options: QueryOptions = {}, headHash?: string): Promise<Atom[]> {
      if (identities.length === 0) return [];
      const hash = headHash || await this.getHeadHash();
      return this.internalQuery(createTargetFromIdentities(identities), options, hash);
  }

  /**
   * BASE: Orchestrates the coarse discovery, expansion, and internalized truth pass.
   */
  private async internalQuery(
    target: QueryTargetAST,
    options: QueryOptions,
    headHash?: string,
  ): Promise<Atom[]> {
    const resolvedOptions = await this.resolveOptions(options);

    // 1. Try Cache First (Fast Path)
    // Only enabled for global/path discovery to avoid redundant full-repo greps.
    // Identity discovery handles its own atomic caching for fine-grained link resolution.
    const fingerprint = getCacheFingerprint(target);
    if (headHash && resolvedOptions.cache !== false && !isBlameTarget(target) && target.type !== 'identity') {
      const cachedHashes = await this.queryCache.get(headHash, fingerprint, resolvedOptions);
      if (cachedHashes) {
        const rawCommits = await this.gitClient.getCommitsByHashes(cachedHashes);
        const atoms = hydrateAtoms(rawCommits, this.protocolRegistry, { includeAllCommits: options.includeAllCommits });
        return this.postProcessAtoms(atoms, resolvedOptions);
      }
    }

    // 2. Initial Discovery Pass
    let initialAtoms: Atom[];

    if (isBlameTarget(target)) {
        initialAtoms = await this.discoveryByBlame(target, resolvedOptions);
    } else if (target.type === 'identity') {
        initialAtoms = await this.discoveryByIdentities(target, headHash, resolvedOptions);
    } else {
        initialAtoms = await this.discoveryByPaths(target, resolvedOptions);
    }

    // 3. Expansion Pass (Transitive Link Following)
    let expandedAtoms = initialAtoms;
    if (resolvedOptions.follow && initialAtoms.length > 0) {
        const maxDepth = resolvedOptions.maxDepth ?? 10;
        expandedAtoms = await this.resolveFollowLinks(initialAtoms, maxDepth, headHash);
    }

    // 4. Projection Pass (Internalized Truth)
    const resultAtoms = this.postProcessAtoms(expandedAtoms, resolvedOptions);

    // 5. Update Cache (Background)
    if (headHash && resolvedOptions.cache !== false && !isBlameTarget(target) && target.type !== 'identity') {
      const hashes = resultAtoms.map(a => a.commitHash);
      this.queryCache.set(headHash, fingerprint, resolvedOptions, hashes).catch(() => {});
    }

    // 6. Domain Filtering (Logical)
    return filterAtoms(resultAtoms, resolvedOptions, this.protocolRegistry);
  }

  /**
   * Coarse Discovery: Search by physical paths and regex patterns.
   */
  private async discoveryByPaths(target: QueryTargetAST, options: QueryOptions): Promise<Atom[]> {
    const paths = target.resolvedPaths;
    const regexPatterns: string[][] = [];
    
    if (!options.includeAllCommits) {
        const discoveryPatterns = options.includeAllCommits ? [] : this.protocolRegistry.getDiscoveryPatterns();
        if (discoveryPatterns.length > 0) regexPatterns.push(discoveryPatterns);
    }
    
    // Authoritative resolution of filters before generating patterns
    const filtersInput = options.filters || [];
    const resolvedFilters = Array.isArray(filtersInput) && filtersInput.length > 0 && typeof filtersInput[0] !== 'string'
        ? (filtersInput as readonly QualifiedFilter[])
        : Array.isArray(filtersInput)
            ? resolveFilterStrings(filtersInput as string[], this.protocolRegistry)
            : resolveFilters(filtersInput as RawFilterMap, this.protocolRegistry);

    const filterPatterns = this.protocolRegistry.getSearchPatterns(resolvedFilters);
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
        revisionRange: target.revisionRange,
        author: options.author || undefined,
        sinceDate: options.sinceDate || undefined,
        untilDate: options.untilDate || undefined,
        maxCommits: options.maxCommits || undefined,
        regexPatterns,
        paths: [...paths],
    });

    return hydrateAtoms(rawCommits, this.protocolRegistry, { includeAllCommits: options.includeAllCommits });
  }

  /**
   * Coarse Discovery: Search by logical identities.
   */
  private async discoveryByIdentities(target: QueryTargetAST, headHash?: string, options: QueryOptions = {}): Promise<Atom[]> {
    const identities = target.identities || [];
    const results: Atom[] = [];
    const missing: QueryIdentity[] = [];

    const root = this.protocolRegistry.getByNamespace(GLOBAL_NAMESPACE);
    if (!root && identities.some(i => !i.protocol)) {
        throw new ProtocolError('Cannot resolve unqualified identity: No global protocol is registered. Please use "protocol/id" format.', 1);
    }
    const primaryProtocol = (root?.def.name || '').toLowerCase();

    // 1. Check Atomic Cache First (Batch)
    const cachedHashes = new Set<string>();
    if (headHash) {
        await Promise.all(identities.map(async (identity) => {
            const pName = (identity.protocol || primaryProtocol).toLowerCase();
            const fingerprint = `identity:${pName}/${identity.id}`;
            const cached = await this.queryCache.get(headHash, fingerprint, {});
            if (cached && cached.length > 0) {
                for (const hash of cached) cachedHashes.add(hash);
            } else {
                missing.push(identity);
            }
        }));

        if (cachedHashes.size > 0) {
            const raw = await this.gitClient.getCommitsByHashes([...cachedHashes]);
            const hydrated = hydrateAtoms(raw, this.protocolRegistry, { includeAllCommits: options.includeAllCommits });
            results.push(...hydrated);
        }
    } else {
        missing.push(...identities);
    }

    if (missing.length === 0) return results;

    // 2. Batch missing IDs into one Git query (Logical Grep)
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
    
    if (patterns.length > 0) {
        const rawCommits = await this.gitClient.query({
            revisionRange: target.revisionRange,
            regexPatterns: [patterns],
            paths: [...this.baseTarget.resolvedPaths]
        });
        const hydrated = hydrateAtoms(rawCommits, this.protocolRegistry, { includeAllCommits: options.includeAllCommits });

        // 3. Match result atoms back to requested missing identities
        const foundFromGit: Atom[] = [];
        for (const { id, protocol: pName } of missing) {
            const matchingAtom = hydrated.find(a => {
                // Priority 1: If protocol specified, check only that one
                if (pName) {
                    const ctx = this.protocolRegistry.get(pName);
                    const state = a.protocols.get(pName.toLowerCase()) || a.protocols.get(pName);
                    if (!state || !ctx) return false;
                    const foundId = getProtocolIdentity(state, ctx);
                    return foundId?.toLowerCase() === id.toLowerCase();
                }

                // Priority 2: If no protocol, check ALL registered protocols (Disambiguation)
                for (const [name, state] of a.protocols) {
                    const ctx = this.protocolRegistry.get(name);
                    if (ctx) {
                        const foundId = getProtocolIdentity(state, ctx);
                        if (foundId?.toLowerCase() === id.toLowerCase()) return true;
                    }
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
        results.push(...foundFromGit);
    }

    return results;
  }

  /**
   * Initial Discovery: Search by specific line ranges using git blame.
   */
  private async discoveryByBlame(target: QueryTargetAST, options: QueryOptions = {}): Promise<Atom[]> {
      const range = target.lineRange;
      if (!range) throw new ProtocolError(`Target "${target.raw}" is not a valid range`, 1);

      const blameLines = await this.gitClient.blame(range.file, range.start, range.end);
      if (blameLines.length === 0) return [];

      const commitHashes = Array.from(new Set(blameLines.map(l => l.commitHash)));
      const rawCommits = await this.gitClient.getCommitsByHashes(commitHashes);
      return hydrateAtoms(rawCommits, this.protocolRegistry, { includeAllCommits: options.includeAllCommits });
  }

  /**
   * Post-Processor: Orchestrates supersession logic and attaches it to the atoms.
   */
  private postProcessAtoms(atoms: Atom[], _options: QueryOptions): Atom[] {
    if (atoms.length === 0) return [];

    const statusMap = resolveSupersession(atoms, this.protocolRegistry);
    
    for (const atom of atoms) {
        for (const [pName, state] of atom.protocols) {
            const ctx = this.protocolRegistry.get(pName);
            if (!ctx) continue;
            
            const id = getProtocolIdentity(state, ctx);
            const protocolStatusMap = statusMap.get(pName.toLowerCase());
            const status: SupersessionStatus | undefined = id ? protocolStatusMap?.get(id) : undefined;
            
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
  async resolveFollowLinks(atoms: readonly Atom[], maxDepth: number, headHash?: string): Promise<Atom[]> {
    const result = [...atoms];
    const visited = new Set(atoms.map((a) => a.commitHash));
    const hash = headHash || await this.getHeadHash();
    
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
          const linkedAtoms = await this.findByIds(missingIdentities, { follow: false }, hash);
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

  async getHeadHash(): Promise<string | undefined> {
    try {
      return await this.gitClient.resolveRef('HEAD');
    } catch {
      return undefined;
    }
  }

  /**
   * Calculates the drift metric for an atom (commits since creation per file).
   * Optimized: Performed in a single Git pass followed by memory counting.
   */
  async getAtomDrift(atom: Atom): Promise<Record<string, number>> {
    const driftMap: Record<string, number> = {};
    for (const file of atom.filesChanged) {
        driftMap[file] = 0;
    }

    const changedFiles = await this.gitClient.getFilesChangedSince(atom.commitHash);
    for (const file of changedFiles) {
        if (driftMap[file] !== undefined) {
            driftMap[file]++;
        }
    }

    return driftMap;
  }

  /**
   * Resolves raw options into Engine-native objects (Dates, ASTs).
   */
  private async resolveOptions(options: QueryOptions): Promise<QueryOptions> {
    const resolved: QueryOptions = { ...options };
    const filters = options.filters || [];
    
    const resolvedFilters = Array.isArray(filters) && filters.length > 0 && typeof filters[0] !== 'string'
        ? (filters as readonly QualifiedFilter[])
        : Array.isArray(filters)
            ? resolveFilterStrings(filters as string[], this.protocolRegistry)
            : resolveFilters(filters as RawFilterMap, this.protocolRegistry);

    // Replace the loose filter/date fields with resolved engine equivalents
    const resolvedValues = {
        filters: resolvedFilters,
        sinceDate: (options.since && !options.sinceDate) ? (await this.gitClient.resolveDate(options.since)) : options.sinceDate,
        untilDate: (options.until && !options.untilDate) ? (await this.gitClient.resolveDate(options.until)) : options.untilDate,
    };

    return {
        ...resolved,
        ...resolvedValues
    };
  }
}
