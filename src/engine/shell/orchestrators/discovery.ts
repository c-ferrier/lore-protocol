import { filterAtoms, resolveFilters, resolveFilterStrings } from '../../core/logic/filtering.js';
import { extractReferenceIds, hydrateAtoms } from '../../core/logic/hydration.js';
import { getProtocolIdentity } from '../../core/logic/identity.js';
import { normalizeTrailers } from '../../core/logic/normalization.js';
import { authorizeKey } from '../../core/logic/ownership.js';
import { getClaimedProtocolKeys, getRootProtocol } from '../../core/logic/protocols.js';
import { 
    createTargetFromIdentities, 
    getCacheFingerprint, 
    getGitBlameArgs, 
    isBlameTarget, 
    resolveQueryOptions
} from '../../core/logic/query-targets.js';
import { escapeRegex } from '../../core/logic/regex.js';
import { attachSupersessionToAtoms } from '../../core/logic/supersession.js';
import { parseTrailers } from '../../core/logic/trailers.js';
import { isValidProtocolIdentity } from '../../core/logic/validation.js';
import { type Atom,ProtocolMap } from '../../core/types/domain.js';
import type { ProtocolContext } from '../../core/types/protocol-definition.js';
import type { QualifiedFilter, QueryIdentity, QueryOptions, QueryTargetAST, RawFilterMap } from '../../core/types/query.js';
import type { IGitClient, RawCommit } from '../../interfaces/git-client.js';
import type { IQueryCache } from '../../interfaces/query-cache.js';
import { ProtocolError } from '../../util/errors.js';
import { getDiscoveryPatterns, getSearchPatterns } from '../git/protocol-query-adapter.js';

/**
 * Shared infrastructure dependencies for discovery operations.
 */
export interface DiscoveryInfra {
  readonly git: IGitClient;
  readonly cache: IQueryCache;
  readonly protocols: ProtocolMap<ProtocolContext>;
}

/**
 * Context for a single discovery operation.
 */
interface DiscoveryContext {
    readonly infra: DiscoveryInfra;
    readonly options: QueryOptions;
    readonly resolvedOptions: QueryOptions; 
    readonly visitedHashes: Set<string>;
    readonly yieldedHashes: Set<string>;
    readonly graveyard: Map<string, string[]>; 
    readonly headHash?: string;
}

/**
 * HIGH-LEVEL: The primary entry point for chronological atom discovery.
 */
export async function findAtoms(
  infra: DiscoveryInfra,
  target: QueryTargetAST,
  options: QueryOptions = {}
): Promise<Atom[]> {
  const results: Atom[] = [];
  for await (const atom of findAtomsStream(infra, target, options)) {
      results.push(atom);
  }
  return results;
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
  const results: Atom[] = [];
  for await (const atom of findAtomsStream(infra, createTargetFromIdentities(identities), options, headHash)) {
      results.push(atom);
  }
  return results;
}

/**
 * High-performance streaming discovery orchestrator.
 */
export async function* findAtomsStream(
  infra: DiscoveryInfra,
  target: QueryTargetAST,
  options: QueryOptions = {},
  headHash?: string,
): AsyncIterableIterator<Atom> {
    const hash = headHash || await getHeadHash(infra.git);
    const resolvedOptions = await resolveQueryOptions(options, infra.protocols, (ref) => infra.git.resolveDate(ref));
    
    const ctx: DiscoveryContext = {
        infra,
        options,
        resolvedOptions,
        visitedHashes: new Set(),
        yieldedHashes: new Set(),
        graveyard: new Map(),
        headHash: hash
    };

    yield* internalQueryStream(ctx, target);
}

/**
 * BASE: Orchestrates the reactive "Sweep and Hop" discovery pipeline.
 */
async function* internalQueryStream(
  ctx: DiscoveryContext,
  target: QueryTargetAST
): AsyncIterableIterator<Atom> {
  const { infra, resolvedOptions, headHash } = ctx;
  const { git, cache, protocols } = infra;

  // 1. Try Cache First
  const fingerprint = getCacheFingerprint(target);
  if (headHash && resolvedOptions.cache !== false && !isBlameTarget(target) && target.type !== 'identity') {
    const cachedHashes = await cache.get(headHash, fingerprint, resolvedOptions);
    if (cachedHashes) {
      const rawCommits = await git.getCommitsByHashes(cachedHashes);
      const atoms = hydrateAtoms(rawCommits, protocols, { includeAllCommits: ctx.options.includeAllCommits });
      const processed = attachSupersessionToAtoms(atoms, protocols);
      const filtered = filterAtoms(processed, resolvedOptions, protocols);
      for (const atom of filtered) {
          if (!ctx.yieldedHashes.has(atom.commitHash)) {
              ctx.yieldedHashes.add(atom.commitHash);
              yield atom;
          }
      }
      return;
    }
  }

  // 2. Initial Discovery Pass
  const initialAtoms: Atom[] = [];
  if (isBlameTarget(target)) {
      const range = getGitBlameArgs(target);
      const blameLines = await git.blame(range.file, range.lineStart, range.lineEnd);
      const hashes = Array.from(new Set(blameLines.map(l => l.commitHash)));
      const raw = await git.getCommitsByHashes(hashes);
      const hydrated = hydrateAtoms(raw, protocols, { includeAllCommits: true });
      const projected = attachSupersessionToAtoms(hydrated, protocols);
      initialAtoms.push(...projected);
  } else if (target.type === 'identity') {
      const matched = await discoveryByIdentitiesMatched(ctx, target);
      initialAtoms.push(...matched);
  } else {
      const query = {
          revisionRange: target.revisionRange,
          author: resolvedOptions.author || undefined,
          sinceDate: resolvedOptions.sinceDate || undefined,
          untilDate: resolvedOptions.untilDate || undefined,
          maxCommits: resolvedOptions.maxCommits || undefined,
          regexPatterns: getDiscoveryRegexPatterns(infra, resolvedOptions),
          paths: target.resolvedPaths
      };

      for await (const raw of git.queryStream(query)) {
          const hydrated = hydrateAtoms([raw], protocols, { includeAllCommits: ctx.options.includeAllCommits });
          for (const a of processAndYield(ctx, hydrated)) {
              initialAtoms.push(a);
              yield a;
          }
      }
  }

  // Expansion and projection for non-path discovery
  if (initialAtoms.length > 0 && (isBlameTarget(target) || target.type === 'identity')) {
      for (const a of processAndYield(ctx, initialAtoms)) yield a;
  }

  // 3. Expansion Pass (Transitive Link Following)
  if (resolvedOptions.follow && initialAtoms.length > 0) {
      const maxDepth = resolvedOptions.maxDepth ?? 10;
      let depth = 1;
      let currentLevel = [...initialAtoms];

      while (depth <= maxDepth && currentLevel.length > 0) {
          const nextIdentities = extractReferenceIds(currentLevel, protocols);
          if (nextIdentities.length === 0) break;

          const target = createTargetFromIdentities(nextIdentities);
          const matched = await discoveryByIdentitiesMatched(ctx, target);
          
          const nextLevel: Atom[] = [];
          for (const a of processAndYield(ctx, matched)) {
              nextLevel.push(a);
              yield a;
          }
          currentLevel = nextLevel;
          depth++;
      }
  }
}

/**
 * Reactive processor: Updates graveyard and applies projection before yield.
 */
function* processAndYield(ctx: DiscoveryContext, atoms: Atom[]): Generator<Atom> {
    const { protocols } = ctx.infra;
    const claimedKeys = getClaimedProtocolKeys(protocols);

    for (const atom of atoms) {
        if (ctx.yieldedHashes.has(atom.commitHash)) continue;

        // BRUTE FORCE DISAMBIGUATION: Ensure all protocols get a chance to claim un-namespaced trailers
        const parsedRaw = parseTrailers(atom.rawTrailers);
        for (const p of protocols.values()) {
            const pNameKey = p.def.name.toLowerCase();
            if (atom.protocols.has(pNameKey)) continue;

            // SPECIAL DISAMBIGUATION RULE: During brute-force, we allow protocols 
            // to check the root level even if they are namespaced.
            const bruteContext = { ...p, isRoot: true }; 
            const normalized = normalizeTrailers(parsedRaw, bruteContext, claimedKeys);
            const id = getProtocolIdentity(normalized, p);
            if (id) atom.protocols.set(pNameKey, normalized);
        }
        
        for (const [pName, state] of atom.protocols) {
            const pCtx = protocols.get(pName) || protocols.get(pName.toLowerCase());
            if (!pCtx) continue;
            
            const myId = getProtocolIdentity(state, pCtx);

            // 1. Record what this atom supersedes
            const victimIds = state.trailers['Supersedes'] || [];
            for (const vId of victimIds) {
                const existing = ctx.graveyard.get(vId) || [];
                const killerId = myId || atom.commitHash;
                if (!existing.includes(killerId)) existing.push(killerId);
                ctx.graveyard.set(vId, existing);
            }

            // 2. Check if THIS atom is in the graveyard
            if (myId && ctx.graveyard.has(myId)) {
                state.supersession = {
                    superseded: true,
                    supersededBy: ctx.graveyard.get(myId)!
                };
            }
        }

        // 3. Filtering and yield
        const filtered = filterAtoms([atom], ctx.resolvedOptions, protocols);
        if (filtered.length > 0) {
            ctx.yieldedHashes.add(atom.commitHash);
            yield filtered[0];
        }
    }
}

/**
 * Discovery by identity with secondary matching verification.
 */
async function discoveryByIdentitiesMatched(
    ctx: DiscoveryContext, 
    target: QueryTargetAST
): Promise<Atom[]> {
    const { git, protocols, cache } = ctx.infra;
    const { headHash } = ctx;
    const identities = target.identities || [];
    const root = getRootProtocol(protocols);
    const claimedKeys = getClaimedProtocolKeys(protocols);
    
    if (!root && identities.some(i => !i.protocol)) {
        throw new ProtocolError('Cannot resolve unqualified identity: No global protocol is registered. Please use "protocol/id" format.', 1);
    }

    const primaryProtocol = (root?.def.name || '').toLowerCase();
    const missing: QueryIdentity[] = [];
    const cachedAtoms: Atom[] = [];

    // 1. Check Cache
    if (headHash && ctx.resolvedOptions.cache !== false) {
        for (const identity of identities) {
            const pName = (identity.protocol || primaryProtocol).toLowerCase();
            const fingerprint = `identity:${pName}/${identity.id}`;
            const cached = await cache.get(headHash, fingerprint, {});
            if (cached && cached.length > 0) {
                const raw = await git.getCommitsByHashes(cached);
                const hydrated = hydrateAtoms(raw, protocols, { includeAllCommits: true });
                const projected = attachSupersessionToAtoms(hydrated, protocols);
                cachedAtoms.push(...projected);
            } else {
                missing.push(identity);
            }
        }
    } else {
        missing.push(...identities);
    }

    if (missing.length === 0) return cachedAtoms;

    // 2. Search Git
    const patterns: string[] = [];
    for (const { id, protocol: pName } of identities) {
      if (!id) continue;
      const targetProtocols = pName ? [protocols.get(pName) || protocols.get(pName.toLowerCase())!] : Array.from(protocols.values());
      for (const p of targetProtocols) {
        if (p && isValidProtocolIdentity(id, p.def)) {
            // Match the exact pattern expected by contract tests
            const ns = p.def.namespace;
            if (ns) {
                patterns.push(`^${escapeRegex(ns)}: ${escapeRegex(p.def.identityKey)}: ${escapeRegex(id)}$`);
            } else {
                patterns.push(`^${escapeRegex(p.def.identityKey)}: ${escapeRegex(id)}$`);
            }
        }
      }
    }

    
    if (patterns.length === 0) return cachedAtoms;

    const query = {
        revisionRange: target.revisionRange,
        regexPatterns: [patterns],
        paths: []
    };

    const results: RawCommit[] = [];
    for await (const raw of git.queryStream(query)) {
        results.push(raw);
    }
    
    const matchedAtoms: Atom[] = [...cachedAtoms];
    const hydrated = hydrateAtoms(results, protocols, { includeAllCommits: true });
    
    for (const atom of hydrated) {
        // Brute force disambiguation
        const parsedRaw = parseTrailers(atom.rawTrailers);
        for (const p of protocols.values()) {
            const pNameKey = p.def.name.toLowerCase();
            if (atom.protocols.has(pNameKey)) continue;

            // SPECIAL DISAMBIGUATION RULE: Allow namespaced protocols to check root during brute-force.
            const bruteContext = { ...p, isRoot: true };
            const normalized = normalizeTrailers(parsedRaw, bruteContext, claimedKeys);
            const id = getProtocolIdentity(normalized, p);
            if (id) atom.protocols.set(pNameKey, normalized);
        }

        let isMatch = false;
        for (const { id, protocol: pName } of identities) {
            if (pName) {
                const pCtx = protocols.get(pName) || protocols.get(pName.toLowerCase());
                const state = atom.protocols.get(pName.toLowerCase()) || atom.protocols.get(pName);
                if (!state || !pCtx) continue;
                const foundId = getProtocolIdentity(state, pCtx);
                if (foundId?.toLowerCase() === id.toLowerCase()) { isMatch = true; break; }
            } else {
                for (const [name, state] of atom.protocols) {
                    const pCtx = protocols.get(name) || protocols.get(name.toLowerCase());
                    if (pCtx) {
                        const foundId = getProtocolIdentity(state, pCtx);
                        if (foundId?.toLowerCase() === id.toLowerCase()) { isMatch = true; break; }
                    }
                }
            }
        }
        if (isMatch) matchedAtoms.push(atom);
    }
    
    return attachSupersessionToAtoms(matchedAtoms, protocols);
}

function getDiscoveryRegexPatterns(infra: DiscoveryInfra, options: QueryOptions): string[][] {
    const { protocols } = infra;
    const regexPatterns: string[][] = [];
    
    if (!options.includeAllCommits) {
        const discoveryPatterns: string[] = [];
        for (const ctx of protocols.values()) {
            discoveryPatterns.push(...getDiscoveryPatterns(ctx));
        }
        if (discoveryPatterns.length > 0) regexPatterns.push(discoveryPatterns);
    }
    
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
            const pPatterns = getSearchPatterns([filter], ctx);
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
    return regexPatterns;
}

/**
 * Resolve BFS traversal for Related/Supersedes/Depends-on links.
 */
export async function resolveFollowLinks(
    infra: DiscoveryInfra, 
    atoms: readonly Atom[], 
    maxDepth: number,
    options: QueryOptions = {},
    headHash?: string
): Promise<Atom[]> {
    const { protocols } = infra;
    const hash = headHash || await getHeadHash(infra.git);
    const resolvedOptions = await resolveQueryOptions(options, protocols, (ref) => infra.git.resolveDate(ref));

    const ctx: DiscoveryContext = {
        infra,
        options,
        resolvedOptions: { ...resolvedOptions, follow: true, maxDepth },
        visitedHashes: new Set(atoms.map(a => a.commitHash)),
        yieldedHashes: new Set(atoms.map(a => a.commitHash)),
        graveyard: new Map(),
        headHash: hash
    };

    const results = [...atoms];
    let depth = 1;
    let currentLevel = [...atoms];
    while (depth <= maxDepth && currentLevel.length > 0) {
        const nextIdentities = extractReferenceIds(currentLevel, protocols);
        if (nextIdentities.length === 0) break;

        const target = createTargetFromIdentities(nextIdentities);
        const matched = await discoveryByIdentitiesMatched(ctx, target);
        
        const nextLevel: Atom[] = [];
        for (const a of processAndYield(ctx, matched)) {
            nextLevel.push(a);
            results.push(a);
        }
        currentLevel = nextLevel;
        depth++;
    }
    return results;
}

/**
 * Calculates drift for a batch of atoms.
 */
export async function calculateDriftBatch(
    infra: { git: IGitClient }, 
    atoms: readonly Atom[]
): Promise<Map<string, Record<string, number>>> {
  if (atoms.length === 0) return new Map();

  const oldestAtom = atoms.reduce((min, a) => 
    (new Date(a.date) < new Date(min.date) ? a : min), 
    atoms[0]
  );

  const results = new Map<string, Record<string, number>>();
  const atomMap = new Map<string, Atom>();
  const globalCounter = new Map<string, number>();

  for (const atom of atoms) {
      results.set(atom.commitHash, {});
      atomMap.set(atom.commitHash, atom);
      for (const file of atom.filesChanged) globalCounter.set(file, 0);
  }

  const stream = infra.git.getLogStream(`${oldestAtom.commitHash}..HEAD`, { nameOnly: true });

  for await (const record of stream) {
      const lines = record.split('\n');
      const hash = lines[0].trim();
      const files = lines.slice(1);

      const matchingAtom = atomMap.get(hash);
      if (matchingAtom) {
          const atomDrift: Record<string, number> = {};
          for (const file of matchingAtom.filesChanged) {
              atomDrift[file] = globalCounter.get(file) || 0;
          }
          results.set(hash, atomDrift);
      }

      for (const file of files) {
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
