import { ProtocolMap, type Atom, type SupersessionStatus } from '../types/domain.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';
import { getProtocolIdentity } from './identity.js';

/**
 * Computes supersession chains and determines which atoms are active vs. superseded.
 * Pure logic: takes atoms and registry, returns a global status map.
 */
export function resolveSupersession(atoms: readonly Atom[], registry: ProtocolRegistry): ProtocolMap<Map<string, SupersessionStatus>> {
  const globalStatusMap = new ProtocolMap<Map<string, SupersessionStatus>>();
  const atomByQualifiedId = new Map<string, Atom>();

  // 1. Initialize global status map and ID lookup
  for (const ctx of registry.getAll()) {
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


  // 2. Resolve direct and transitive supersessions globally
  for (const atom of atoms) {
    for (const [pName, state] of atom.protocols) {
      const ctx = registry.get(pName);
      if (!ctx) continue;

      const id = getProtocolIdentity(state, ctx);
      if (!id) continue;
      const qualifiedId = `${pName.toLowerCase()}/${id}`;

      for (const ref of state.trailers.Supersedes || []) {
        try {
          const targetIdentity = registry.resolveIdentity(ref, pName);
          const targetPName = targetIdentity.protocol || pName;
          const targetQualifiedId = `${targetPName.toLowerCase()}/${targetIdentity.id}`;

          const targetStatusMap = globalStatusMap.get(targetPName.toLowerCase());
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
              globalStatusMap,
              registry
            );
          }
        } catch {
          // Skip unresolvable references
        }
      }
    }
  }

  return globalStatusMap;
}

/**
 * Resolve a transitive supersession chain recursively.
 */
function resolveTransitiveChain(
  currentQualifiedId: string,
  topQualifiedId: string,
  atomByQualifiedId: Map<string, Atom>,
  globalStatusMap: ProtocolMap<Map<string, SupersessionStatus>>,
  registry: ProtocolRegistry,
  visited: Set<string> = new Set()
): void {
  if (visited.has(currentQualifiedId)) return;
  visited.add(currentQualifiedId);

  const atom = atomByQualifiedId.get(currentQualifiedId);
  if (!atom) return;

  for (const [pName, state] of atom.protocols) {
    for (const ref of state.trailers.Supersedes || []) {
      try {
        const targetIdentity = registry.resolveIdentity(ref, pName);
        const targetPName = targetIdentity.protocol || pName;
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
          resolveTransitiveChain(targetQualifiedId, topQualifiedId, atomByQualifiedId, globalStatusMap, registry, visited);
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
  registry: ProtocolRegistry,
): Atom[] {
  return atoms.filter((atom) => {
    let isSupersededInAny = false;
    let hasProtocolMatch = false;

    for (const [pName, statusMap] of globalStatusMap) {
      const state = atom.protocols.get(pName);
      if (!state) continue;

      const ctx = registry.get(pName);
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
