import { ProtocolMap, type Atom, type AtomId, type SupersessionStatus } from '../types/domain.js';
import type { IProtocol } from '../interfaces/protocol.js';
import type { ProtocolRegistry } from './protocol-registry.js';

/**
 * Computes supersession chains and determines which atoms are active vs. superseded.
 * Now supports resolving supersession across multiple protocols.
 */
export class SupersessionResolver {
  constructor(private readonly protocolRegistry: ProtocolRegistry) {}

  /**
   * Resolves a global supersession map for all registered protocols.
   * Uses qualified identities (protocol/id) to support cross-protocol chains.
   */
  resolveAll(atoms: readonly Atom[]): ProtocolMap<Map<string, SupersessionStatus>> {
    const globalStatusMap = new ProtocolMap<Map<string, SupersessionStatus>>();
    const atomByQualifiedId = new Map<string, Atom>();

    // 1. Initialize global status map and ID lookup
    for (const protocol of this.protocolRegistry.getAll()) {
      const pName = protocol.name;
      const statusMap = new Map<string, SupersessionStatus>();
      globalStatusMap.set(pName, statusMap);

      for (const atom of atoms) {
        const state = atom.protocols.get(pName);
        const id = protocol.getIdentity(state);
        if (id) {
          statusMap.set(id, { superseded: false, supersededBy: [] });
          atomByQualifiedId.set(`${pName.toLowerCase()}/${id}`, atom);
        }
      }
    }


    // 2. Resolve direct and transitive supersessions globally
    for (const atom of atoms) {
      for (const [pName, state] of atom.protocols) {
        const protocol = this.protocolRegistry.get(pName);
        if (!protocol) continue;

        const id = protocol.getIdentity(state);
        if (!id) continue;
        const qualifiedId = `${pName.toLowerCase()}/${id}`;

        for (const ref of state.trailers.Supersedes || []) {
          try {
            const targetIdentity = this.protocolRegistry.resolveIdentity(ref, pName);
            const targetPName = targetIdentity.protocol || pName;
            const targetQualifiedId = `${targetPName.toLowerCase()}/${targetIdentity.id}`;

            const targetStatusMap = globalStatusMap.get(targetPName);
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
              this.resolveTransitiveChain(
                targetQualifiedId,
                displaySupersededBy,
                atomByQualifiedId,
                globalStatusMap
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
  private resolveTransitiveChain(
    currentQualifiedId: string,
    topQualifiedId: string,
    atomByQualifiedId: Map<string, Atom>,
    globalStatusMap: ProtocolMap<Map<string, SupersessionStatus>>,
    visited: Set<string> = new Set()
  ): void {
    if (visited.has(currentQualifiedId)) return;
    visited.add(currentQualifiedId);

    const atom = atomByQualifiedId.get(currentQualifiedId);
    if (!atom) return;

    for (const [pName, state] of atom.protocols) {
      for (const ref of state.trailers.Supersedes || []) {
        try {
          const targetIdentity = this.protocolRegistry.resolveIdentity(ref, pName);
          const targetPName = targetIdentity.protocol || pName;
          const targetQualifiedId = `${targetPName.toLowerCase()}/${targetIdentity.id}`;

          const targetStatusMap = globalStatusMap.get(targetPName);
          if (targetStatusMap?.has(targetIdentity.id)) {
            const status = targetStatusMap.get(targetIdentity.id)!;
            
            if (!status.supersededBy.includes(topQualifiedId)) {
               targetStatusMap.set(targetIdentity.id, {
                 superseded: true,
                 supersededBy: [...status.supersededBy, topQualifiedId],
               });
            }
            this.resolveTransitiveChain(targetQualifiedId, topQualifiedId, atomByQualifiedId, globalStatusMap, visited);
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
  filterActive(
    atoms: readonly Atom[],
    globalStatusMap: ProtocolMap<Map<string, SupersessionStatus>>,
  ): Atom[] {
    return atoms.filter((atom) => {
      let isSupersededInAny = false;
      let hasProtocolMatch = false;

      for (const [pName, statusMap] of globalStatusMap) {
        const state = atom.protocols.get(pName);
        if (!state) continue;

        const protocol = this.protocolRegistry.get(pName);
        if (!protocol) continue;

        const id = protocol.getIdentity(state);

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
}
