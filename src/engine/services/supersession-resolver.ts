import type { Atom, AtomId, SupersessionStatus } from '../types/domain.js';
import type { IProtocol } from '../interfaces/protocol.js';
import type { ProtocolRegistry } from './protocol-registry.js';

/**
 * Computes supersession chains and determines which atoms are active vs. superseded.
 * Now supports resolving supersession across multiple protocols.
 *
 * GRASP: Information Expert -- the data it needs (Supersedes trailers) lives in atoms.
 * SRP: Only supersession logic, no git interaction or formatting.
 */
export class SupersessionResolver {
  constructor(private readonly protocolRegistry: ProtocolRegistry) {}

  /**
   * Resolves supersession for a specific protocol.
   */
  resolveForProtocol(atoms: readonly Atom[], protocol: IProtocol): Map<string, SupersessionStatus> {
    const statusMap = new Map<string, SupersessionStatus>();
    const protocolName = protocol.name.toLowerCase();

    // 1. Initialize all atoms as not superseded
    for (const atom of atoms) {
      const state = atom.protocols.get(protocolName);
      const id = protocol.getIdentity(state?.trailers);
      if (id) {
        statusMap.set(id, {
          superseded: false,
          supersededBy: null,
        });
      }
    }

    // Build a lookup map for quick access
    const atomById = new Map<string, Atom>();
    for (const atom of atoms) {
      const state = atom.protocols.get(protocolName);
      const id = protocol.getIdentity(state?.trailers);
      if (id) {
        atomById.set(id, atom);
      }
    }

    // 2. First pass: mark direct supersessions
    for (const atom of atoms) {
      const state = atom.protocols.get(protocolName);
      if (!state) continue;
      
      const id = protocol.getIdentity(state.trailers);
      if (!id) continue;

      for (const supersededId of state.trailers.Supersedes || []) {
        if (!protocol.isValidIdentity(supersededId)) {
          continue;
        }

        if (statusMap.has(supersededId)) {
          statusMap.set(supersededId, {
            superseded: true,
            supersededBy: id,
          });
        }
      }
    }

    // 3. Second pass: resolve transitive chains
    this.resolveTransitiveChains(atoms, atomById, statusMap, protocol);

    return statusMap;
  }

  /**
   * Resolves a global supersession map for all registered protocols.
   * Returns a Map of protocolName -> statusMap.
   */
  resolveAll(atoms: readonly Atom[]): Map<string, Map<string, SupersessionStatus>> {
    const results = new Map<string, Map<string, SupersessionStatus>>();
    for (const protocol of this.protocolRegistry.getAll()) {
        results.set(protocol.name.toLowerCase(), this.resolveForProtocol(atoms, protocol));
    }
    return results;
  }

  /**
   * Filter atoms to only those that are active (not superseded in any matching protocol).
   */
  filterActive(
    atoms: readonly Atom[],
    globalStatusMap: Map<string, Map<string, SupersessionStatus>>,
  ): Atom[] {
    return atoms.filter((atom) => {
      let isSupersededInAny = false;
      let hasProtocolMatch = false;

      for (const [pName, statusMap] of globalStatusMap) {
        const state = atom.protocols.get(pName);
        const protocol = this.protocolRegistry.get(pName);
        if (!protocol) continue;

        const id = protocol.getIdentity(state?.trailers);

        if (id) {
          hasProtocolMatch = true;
          const status = statusMap.get(id);
          if (status?.superseded) {
              isSupersededInAny = true;
              break;
          }
        }
      }

      // If it's a protocol atom and superseded in its context, hide it.
      // If it's not a protocol atom (agnostic mode), always show it.
      return !hasProtocolMatch || !isSupersededInAny;
    });
  }

  /**
   * Resolve transitive supersession chains for a specific protocol.
   */
  private resolveTransitiveChains(
    atoms: readonly Atom[],
    atomById: Map<string, Atom>,
    statusMap: Map<string, SupersessionStatus>,
    protocol: IProtocol,
  ): void {
    const protocolName = protocol.name.toLowerCase();

    for (const atom of atoms) {
      const state = atom.protocols.get(protocolName);
      const id = protocol.getIdentity(state?.trailers);
      if (!id) continue;
      
      const supersedes = state?.trailers.Supersedes || [];
      if (supersedes.length === 0) {
        continue;
      }

      const visited = new Set<string>();
      visited.add(id);

      const queue: AtomId[] = [...supersedes];

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) {
          continue;
        }
        visited.add(currentId);

        if (!protocol.isValidIdentity(currentId)) {
          continue;
        }

        if (statusMap.has(currentId)) {
          const currentStatus = statusMap.get(currentId)!;
          if (!currentStatus.superseded) {
            statusMap.set(currentId, {
              superseded: true,
              supersededBy: id,
            });
          }
        }

        const supersededAtom = atomById.get(currentId);
        if (supersededAtom) {
          const supersededState = supersededAtom.protocols.get(protocolName);
          for (const nextId of supersededState?.trailers.Supersedes || []) {
            if (!visited.has(nextId)) {
              queue.push(nextId);
            }
          }
        }
      }
    }
  }
}
