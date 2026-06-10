import { filterAtoms, resolveFilters, resolveFilterStrings } from '../../core/logic/filtering.js';
import { extractReferenceIds, hydrateAtoms } from '../../core/logic/hydration.js';
import { getProtocolIdentity } from '../../core/logic/identity.js';
import { authorizeKey } from '../../core/logic/ownership.js';
import { getRootProtocol } from '../../core/logic/protocols.js';
import { 
    createTargetFromIdentities, 
    getCacheFingerprint, 
    getGitBlameArgs, 
    isBlameTarget, 
    resolveQueryOptions
} from '../../core/logic/query-targets.js';
import { escapeRegex } from '../../core/logic/regex.js';
import { attachSupersessionToAtoms } from '../../core/logic/supersession.js';
import { isValidProtocolIdentity } from '../../core/logic/validation.js';
import { type Atom,ProtocolMap } from '../../core/types/domain.js';
import type { ProtocolContext } from '../../core/types/protocol-definition.js';
import type { QualifiedFilter, QueryIdentity, QueryOptions, QueryTargetAST, RawFilterMap } from '../../core/types/query.js';
import type { IGitClient } from '../../interfaces/git-client.js';
import type { IQueryCache } from '../../interfaces/query-cache.js';
import { ProtocolError } from '../../util/errors.js';
import { getIdentityPattern } from '../git/protocol-query-adapter.js';

/**
 * Shared infrastructure dependencies for discovery operations.
 */
export interface DiscoveryInfra {
  readonly git: IGitClient;
  readonly cache: IQueryCache;
  readonly protocols: ProtocolMap<ProtocolContext>;
}

/**
 * HIGH-LEVEL: The primary entry point for chronological atom discovery.
 * Unifies path-scoped, multi-path, ID-based, and global history queries.
 */
export async function findAtoms(
  infra: DiscoveryInfra,
  target: QueryTargetAST,
  options: QueryOptions = {}
): Promise<Atom[]> {
  const headHash = await getHeadHash(infra.git);
  return internalQuery(infra, target, options, headHash);
}

/**
 * Find a single atom by its identity key.
 */
export async function findAtomById(
  infra: DiscoveryInfra,
  identity: QueryIdentity,
  options: QueryOptions = {}
): Promise<Atom | null> {
  const atoms = await findAtomsByIds(infra, [identity], options);
  return atoms[0] || null;
}

/**
 * Find multiple atoms by their identity keys.
 */
export async function findAtomsByIds(
  infra: DiscoveryInfra,
  identities: readonly QueryIdentity[],
  options: QueryOptions = {},
  headHash?: string
): Promise<Atom[]> {
  if (identities.length === 0) return [];
  const hash = headHash || await getHeadHash(infra.git);
  return internalQuery(infra, createTargetFromIdentities(identities), options, hash);
}

/**
 * BASE: Orchestrates the coarse discovery, expansion, and internalized truth pass.
 */
async function internalQuery(
  infra: DiscoveryInfra,
  target: QueryTargetAST,
  options: QueryOptions,
  headHash?: string,
): Promise<Atom[]> {
  const { git, cache, protocols } = infra;
  const resolvedOptions = await resolveQueryOptions(options, protocols, (ref) => git.resolveDate(ref));

  // 1. Try Cache First (Fast Path)
  const fingerprint = getCacheFingerprint(target);
  if (headHash && resolvedOptions.cache !== false && !isBlameTarget(target) && target.type !== 'identity') {
    const cachedHashes = await cache.get(headHash, fingerprint, resolvedOptions);
    if (cachedHashes) {
      const rawCommits = await git.getCommitsByHashes(cachedHashes);
      const atoms = hydrateAtoms(rawCommits, protocols, { includeAllCommits: options.includeAllCommits });
      return postProcessAtoms(atoms, resolvedOptions, protocols);
    }
  }

  // 2. Initial Discovery Pass
  let initialAtoms: Atom[];

  if (isBlameTarget(target)) {
      initialAtoms = await discoveryByBlame(infra, target, resolvedOptions);
  } else if (target.type === 'identity') {
      initialAtoms = await discoveryByIdentities(infra, target, headHash, resolvedOptions);
  } else {
      initialAtoms = await discoveryByPaths(infra, target, resolvedOptions);
  }

  // 3. Expansion Pass (Transitive Link Following)
  let expandedAtoms = initialAtoms;
  if (resolvedOptions.follow && initialAtoms.length > 0) {
      const maxDepth = resolvedOptions.maxDepth ?? 10;
      expandedAtoms = await resolveFollowLinks(infra, initialAtoms, maxDepth, headHash);
  }

  // 4. Projection Pass (Internalized Truth)
  const resultAtoms = postProcessAtoms(expandedAtoms, resolvedOptions, protocols);

  // 5. Update Cache (Background)
  if (headHash && resolvedOptions.cache !== false && !isBlameTarget(target) && target.type !== 'identity') {
    const hashes = resultAtoms.map(a => a.commitHash);
    cache.set(headHash, fingerprint, resolvedOptions, hashes).catch(() => {});
  }

  // 6. Domain Filtering (Logical)
  return filterAtoms(resultAtoms, resolvedOptions, protocols);
}

/**
 * Coarse Discovery: Search by physical paths and regex patterns.
 */
async function discoveryByPaths(
    infra: DiscoveryInfra, 
    target: QueryTargetAST, 
    options: QueryOptions
): Promise<Atom[]> {
    const { git, protocols } = infra;
    const paths = target.resolvedPaths;
    const regexPatterns: string[][] = [];
    
    if (!options.includeAllCommits) {
        const discoveryPatterns: string[] = [];
        for (const ctx of protocols.values()) {
            discoveryPatterns.push(...logicGetDiscoveryPatterns(ctx));
        }
        if (discoveryPatterns.length > 0) regexPatterns.push(discoveryPatterns);
    }
    
    // Authoritative resolution of filters before generating patterns
    const filtersInput = options.filters || [];
    const resolvedFilters = Array.isArray(filtersInput) && filtersInput.length > 0 && typeof filtersInput[0] !== 'string'
        ? (filtersInput as readonly QualifiedFilter[])
        : Array.isArray(filtersInput)
            ? resolveFilterStrings(filtersInput as string[], protocols)
            : resolveFilters(filtersInput as RawFilterMap, protocols);

    const filterPatterns: string[][] = [];
    for (const filter of resolvedFilters) {
        const orSet: string[] = [];
        const ctx = filter.protocol ? protocols.get(filter.protocol) : resolveProtocolKey(protocols, filter.key);
        if (ctx) {
            const pPatterns = logicGetSearchPatterns([filter], ctx);
            for (const set of pPatterns) orSet.push(...set);
        }
        if (orSet.length > 0) filterPatterns.push(Array.from(new Set(orSet)));
    }
    regexPatterns.push(...filterPatterns);

    if (options.scope) {
      const pattern = options.scope.startsWith('^[a-zA-Z]+\\(') 
        ? options.scope 
        : `^[a-zA-Z]+\\(${escapeRegex(options.scope)}\\):`;
      regexPatterns.push([pattern]);
    }
    
    if (options.has) {
        const hasPatterns: string[] = [];
        for (const ctx of protocols.values()) {
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

    const rawCommits = await git.query({
        revisionRange: target.revisionRange,
        author: options.author || undefined,
        sinceDate: options.sinceDate || undefined,
        untilDate: options.untilDate || undefined,
        maxCommits: options.maxCommits || undefined,
        regexPatterns,
        paths: [...paths],
    });

    return hydrateAtoms(rawCommits, protocols, { includeAllCommits: options.includeAllCommits });
}

/**
 * Coarse Discovery: Search by logical identities.
 */
async function discoveryByIdentities(
    infra: DiscoveryInfra, 
    target: QueryTargetAST, 
    headHash?: string, 
    options: QueryOptions = {}
): Promise<Atom[]> {
    const { git, cache, protocols } = infra;
    const identities = target.identities || [];
    const results: Atom[] = [];
    const missing: QueryIdentity[] = [];

    const root = getRootProtocol(protocols);
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
            const cached = await cache.get(headHash, fingerprint, {});
            if (cached && cached.length > 0) {
                for (const hash of cached) cachedHashes.add(hash);
            } else {
                missing.push(identity);
            }
        }));

        if (cachedHashes.size > 0) {
            const raw = await git.getCommitsByHashes([...cachedHashes]);
            const hydrated = hydrateAtoms(raw, protocols, { includeAllCommits: options.includeAllCommits });
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
      const targetProtocols = pName ? [protocols.get(pName)!] : Array.from(protocols.values());
      for (const ctx of targetProtocols) {
        if (ctx && isValidProtocolIdentity(id, ctx.def)) {
            patterns.push(getIdentityPattern(id, ctx));
        }
      }
    }
    
    if (patterns.length > 0) {
        const rawCommits = await git.query({
            revisionRange: target.revisionRange,
            regexPatterns: [patterns],
            paths: [] // Identities are cross-path
        });
        const hydrated = hydrateAtoms(rawCommits, protocols, { includeAllCommits: options.includeAllCommits });

        // 3. Match result atoms back to requested missing identities
        const foundFromGit: Atom[] = [];
        for (const { id, protocol: pName } of missing) {
            const matchingAtom = hydrated.find(a => {
                // Priority 1: If protocol specified, check only that one
                if (pName) {
                    const ctx = protocols.get(pName);
                    const state = a.protocols.get(pName.toLowerCase()) || a.protocols.get(pName);
                    if (!state || !ctx) return false;
                    const foundId = getProtocolIdentity(state, ctx);
                    return foundId?.toLowerCase() === id.toLowerCase();
                }

                // Priority 2: If no protocol, check ALL registered protocols (Disambiguation)
                for (const [name, state] of a.protocols) {
                    const ctx = protocols.get(name);
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
                    cache.set(headHash, fingerprint, {}, [matchingAtom.commitHash]).catch(() => {});
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
async function discoveryByBlame(
    infra: DiscoveryInfra, 
    target: QueryTargetAST, 
    options: QueryOptions = {}
): Promise<Atom[]> {
    const { git, protocols } = infra;
    const range = getGitBlameArgs(target);
    if (!target.lineRange) throw new ProtocolError(`Target "${target.raw}" is not a valid range`, 1);

    const blameLines = await git.blame(range.file, range.lineStart, range.lineEnd);
    if (blameLines.length === 0) return [];

    const commitHashes = Array.from(new Set(blameLines.map(l => l.commitHash)));
    const rawCommits = await git.getCommitsByHashes(commitHashes);
    return hydrateAtoms(rawCommits, protocols, { includeAllCommits: options.includeAllCommits });
}

/**
 * Post-Processor: Orchestrates supersession logic and attaches it to the atoms.
 */
function postProcessAtoms(atoms: Atom[], _options: QueryOptions, protocols: ProtocolMap<ProtocolContext>): Atom[] {
    return attachSupersessionToAtoms(atoms, protocols);
}

/**
 * Resolve BFS traversal for Related/Supersedes/Depends-on links.
 */
export async function resolveFollowLinks(
    infra: DiscoveryInfra, 
    atoms: readonly Atom[], 
    maxDepth: number, 
    headHash?: string
): Promise<Atom[]> {
    const { git, protocols } = infra;
    const result = [...atoms];
    const visited = new Set(atoms.map((a) => a.commitHash));
    const hash = headHash || await getHeadHash(git);
    
    const localKnowledge = new Map<string, Atom>();
    const indexAtoms = (list: readonly Atom[]) => {
        const root = getRootProtocol(protocols);
        const rootName = root?.def.name.toLowerCase();

        for (const atom of list) {
            localKnowledge.set(atom.commitHash, atom);
            
            for (const [pName, state] of atom.protocols) {
                const ctx = protocols.get(pName);
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
      { identities: extractReferenceIds(atoms, protocols), depth: 1 },
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
          const linkedAtoms = await findAtomsByIds(infra, missingIdentities, { follow: false }, hash);
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
        queue.push({ identities: extractReferenceIds(newAtoms, protocols), depth: depth + 1 });
      }
    }

    return result;
}

/**
 * Calculates the drift metric for an atom (commits since creation per file).
 */
/**
 * Calculates drift for a batch of atoms in a single chronological pass.
 * High-performance: $O(History)$ instead of $O(Atoms * History)$.
 * Memory-safe: Streams history line-by-line using the Universal Log Stream.
 */
export async function calculateDriftBatch(
    infra: { git: IGitClient }, 
    atoms: readonly Atom[]
): Promise<Map<string, Record<string, number>>> {
  if (atoms.length === 0) return new Map();

  // 1. Find the oldest atom (the "Horizon")
  const oldestAtom = atoms.reduce((min, a) => 
    (new Date(a.date) < new Date(min.date) ? a : min), 
    atoms[0]
  );

  // 2. Prepare result maps and indexing
  const results = new Map<string, Record<string, number>>();
  const atomMap = new Map<string, Atom>();
  const globalCounter = new Map<string, number>();

  for (const atom of atoms) {
      results.set(atom.commitHash, {});
      atomMap.set(atom.commitHash, atom);
      for (const file of atom.filesChanged) {
          globalCounter.set(file, 0);
      }
  }

  // 3. Reverse Sweep (Newest -> Oldest)
  const stream = infra.git.getLogStream(`${oldestAtom.commitHash}..HEAD`, { nameOnly: true });

  for await (const record of stream) {
      // Snapshot BEFORE incrementing (drift is commits AFTER the atom)
      const matchingAtom = atomMap.get(record.hash);
      if (matchingAtom) {
          const atomDrift: Record<string, number> = {};
          for (const file of matchingAtom.filesChanged) {
              atomDrift[file] = globalCounter.get(file) || 0;
          }
          results.set(record.hash, atomDrift);
      }

      // Update the running drift counters for all tracked files
      for (const file of record.lines) {
          const current = globalCounter.get(file);
          if (current !== undefined) {
              globalCounter.set(file, current + 1);
          }
      }
  }

  return results;
}

async function getHeadHash(git: IGitClient): Promise<string | undefined> {
  try {
    return await git.resolveRef('HEAD');
  } catch {
    return undefined;
  }
}

// Helpers for logic functions that were previously on ProtocolRegistry
function logicGetDiscoveryPatterns(ctx: ProtocolContext): string[] {
    const { def, isRoot } = ctx;
    if (!isRoot) {
        return [`^${escapeRegex(def.namespace)}:`];
    }
    const tDef = def.trailers[def.identityKey];
    let pattern = `^${escapeRegex(def.identityKey)}: `;
    if (tDef?.pattern) {
        const cleanPattern = tDef.pattern.replace(/^\^/, '').replace(/\$$/, '');
        pattern += cleanPattern;
    }
    return [pattern];
}

function logicGetSearchPatterns(filters: readonly QualifiedFilter[], ctx: ProtocolContext): string[][] {
    const patterns: string[] = [];
    const { storagePrefix } = ctx;
    for (const filter of filters) {
        const authorizedKey = authorizeKey(filter.key, ctx);
        if (!authorizedKey) continue;
        if (filter.op === 'has') {
            patterns.push(`^${escapeRegex(storagePrefix)}${escapeRegex(authorizedKey)}:`);
        } else if (filter.op === 'eq') {
            const values = Array.isArray(filter.value) ? filter.value : [filter.value];
            for (const val of values) {
                patterns.push(`^${escapeRegex(storagePrefix)}${escapeRegex(authorizedKey)}: ${escapeRegex(String(val))}`);
            }
        }
    }
    return patterns.length > 0 ? [patterns] : [];
}

function resolveProtocolKey(protocols: ProtocolMap<ProtocolContext>, key: string): ProtocolContext | undefined {
    for (const ctx of protocols.values()) {
        if (authorizeKey(key, ctx)) return ctx;
    }
    const nsKey = key.toLowerCase();
    for (const ctx of protocols.values()) {
        if (ctx.storageNamespace.toLowerCase() === nsKey) return ctx;
    }
    return getRootProtocol(protocols);
}
