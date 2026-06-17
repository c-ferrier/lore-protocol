import type { ProtocolMap, SupersessionStatus } from '../types/domain.js';
import { type Atom } from '../types/domain.js';
import type { ProtocolContext } from '../types/protocol-definition.js';
import { getProtocolIdentity } from './identity.js';
import { resolveProtocolIdentity } from './protocols.js';

/**
 * Computes supersession chains and determines which atoms are active vs. superseded.
 * Pure logic: takes atoms and protocol map, returns a global status map.
 */
export function resolveSupersession(
  atoms: readonly Atom[], 
  protocols: ProtocolMap<ProtocolContext>
): ProtocolMap<Map<string, SupersessionStatus>> {
  const globalStatusMap = new Map<string, Map<string, SupersessionStatus>>();
  const atomByQualifiedId = new Map<string, Atom>();

  // 1. Initialize global status map and ID lookup
  for (const ctx of protocols.values()) {
    const pName = ctx.def.name.toLowerCase();
    const statusMap = new Map<string, SupersessionStatus>();
    globalStatusMap.set(pName, statusMap);

    for (const atom of atoms) {
      const state = atom.protocols.get(pName);
      const id = getProtocolIdentity(state, ctx);
      if (id) {
        statusMap.set(id, { superseded: false, supersededBy: [] });
        atomByQualifiedId.set(`${pName}/${id}`, atom);
      }
    }
  }

  const pMap = new Map(globalStatusMap) as ProtocolMap<Map<string, SupersessionStatus>>;

  // 2. Resolve direct and transitive supersessions globally
  for (const atom of atoms) {
    for (const [pName, state] of atom.protocols) {
      const ctx = protocols.get(pName);
      if (!ctx) continue;

      const id = getProtocolIdentity(state, ctx);
      if (!id) continue;
      const qualifiedId = `${pName.toLowerCase()}/${id}`;

      for (const ref of state.trailers.Supersedes || []) {
        try {
          const targetIdentity = resolveProtocolIdentity(protocols, ref, pName);
          const targetPName = targetIdentity.protocol;
          const targetQualifiedId = `${targetPName.toLowerCase()}/${targetIdentity.id}`;

          const targetStatusMap = pMap.get(targetPName.toLowerCase());
          if (targetStatusMap?.has(targetIdentity.id)) {
            // 3. Mark direct supersession
            // Format supersededBy: omit prefix if it matches the target protocol
            const displaySupersededBy = (targetPName.toLowerCase() === pName.toLowerCase()) ? id : qualifiedId;

            const status = targetStatusMap.get(targetIdentity.id)!;
            
            if (!status.supersededBy.includes(displaySupersededBy)) {
                targetStatusMap.set(targetIdentity.id, {
                  superseded: true,
                  supersededBy: [...status.supersededBy, displaySupersededBy],
                });
            }

            // Resolve transitive chain for this link
            resolveTransitiveChain(
              targetQualifiedId,
              displaySupersededBy,
              atomByQualifiedId,
              pMap,
              protocols
            );
          }
        } catch {
          // Skip unresolvable references
        }
      }
    }
  }

  return pMap;
}

/**
 * Resolve a transitive supersession chain recursively.
 */
function resolveTransitiveChain(
  currentQualifiedId: string,
  topQualifiedId: string,
  atomByQualifiedId: Map<string, Atom>,
  globalStatusMap: ProtocolMap<Map<string, SupersessionStatus>>,
  protocols: ProtocolMap<ProtocolContext>,
  visited: Set<string> = new Set()
): void {
  if (visited.has(currentQualifiedId)) return;
  visited.add(currentQualifiedId);

  const atom = atomByQualifiedId.get(currentQualifiedId);
  if (!atom) return;

  for (const [pName, state] of atom.protocols) {
    for (const ref of state.trailers.Supersedes || []) {
      try {
        const targetIdentity = resolveProtocolIdentity(protocols, ref, pName);
        const targetPName = targetIdentity.protocol;
        const targetQualifiedId = `${targetPName.toLowerCase()}/${targetIdentity.id}`;

        const targetStatusMap = globalStatusMap.get(targetPName.toLowerCase());
        if (targetStatusMap?.has(targetIdentity.id)) {
          const status = targetStatusMap.get(targetIdentity.id)!;
          
          if (!status.supersededBy.includes(topQualifiedId)) {
             targetStatusMap.set(targetIdentity.id, {
               superseded: true,
               supersededBy: [...status.supersededBy, topQualifiedId],
             });
          }
          resolveTransitiveChain(targetQualifiedId, topQualifiedId, atomByQualifiedId, globalStatusMap, protocols, visited);
        }
      } catch {
        // Skip
      }
    }
  }
}

/**
 * Filter atoms to only those that are active (not superseded in any matching protocol).
 */
export function filterActiveAtoms(
  atoms: readonly Atom[],
  globalStatusMap: ProtocolMap<Map<string, SupersessionStatus>>,
  protocols: ProtocolMap<ProtocolContext>,
): Atom[] {
  return atoms.filter((atom) => {
    let isSupersededInAny = false;
    let hasProtocolMatch = false;

    for (const [pName, statusMap] of globalStatusMap) {
      const state = atom.protocols.get(pName);
      if (!state) continue;

      const ctx = protocols.get(pName);
      if (!ctx) continue;

      const id = getProtocolIdentity(state, ctx);

      if (id) {
        hasProtocolMatch = true;
        const status = statusMap.get(id);
        if (status?.superseded) {
            isSupersededInAny = true;
            break;
        }
      }
    }

    return !hasProtocolMatch || !isSupersededInAny;
  });
}

/**
 * Orchestrates supersession logic and attaches it to the atoms.
 */
export function attachSupersessionToAtoms(
    atoms: Atom[], 
    protocols: ProtocolMap<ProtocolContext>
): Atom[] {
    if (atoms.length === 0) return [];

    const statusMap = resolveSupersession(atoms, protocols);
    
    for (const atom of atoms) {
        for (const [pName, state] of atom.protocols) {
            const ctx = protocols.get(pName);
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
