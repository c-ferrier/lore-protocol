import type { Atom, AtomId, SupersessionStatus } from '../types/domain.js';
import type { IProtocol } from '../interfaces/protocol.js';

/**
 * Computes supersession chains and determines which atoms are active vs. superseded.
 *
 * GRASP: Information Expert -- the data it needs (Supersedes trailers) lives in atoms.
 * SRP: Only supersession logic, no git interaction or formatting.
 */
export class SupersessionResolver {
  constructor(private readonly protocol: IProtocol) {}

  /**
   * Given a set of atoms, compute which are superseded and by whom.
   * Returns a map from AtomId to SupersessionStatus.
   */
  resolve(atoms: readonly Atom[]): Map<string, SupersessionStatus> {
    const statusMap = new Map<string, SupersessionStatus>();
    const protocolName = this.protocol.name.toLowerCase();

    // Initialize all atoms as not superseded
    for (const atom of atoms) {
      statusMap.set(atom.id, {
        superseded: false,
        supersededBy: null,
      });
    }

    // Build a lookup map for quick access
    const atomById = new Map<string, Atom>();
    for (const atom of atoms) {
      atomById.set(atom.id, atom);
    }

    // First pass: mark direct supersessions
    for (const atom of atoms) {
      const state = atom.protocols.get(protocolName);
      if (!state) continue;

      for (const supersededId of state.trailers.Supersedes || []) {
        if (!this.protocol.isValidIdentity(supersededId)) {
          continue;
        }

        if (statusMap.has(supersededId)) {
          statusMap.set(supersededId, {
            superseded: true,
            supersededBy: atom.id,
          });
        }
      }
    }

    // Second pass: resolve transitive chains
    this.resolveTransitiveChains(atoms, atomById, statusMap);

    return statusMap;
  }

  /**
   * Filter atoms to only those that are active (not superseded).
   */
  filterActive(
    atoms: readonly Atom[],
    supersessionMap: Map<string, SupersessionStatus>,
  ): Atom[] {
    return atoms.filter((atom) => {
      const status = supersessionMap.get(atom.id);
      return status === undefined || !status.superseded;
    });
  }

  /**
   * Resolve transitive supersession chains.
   */
  private resolveTransitiveChains(
    atoms: readonly Atom[],
    atomById: Map<string, Atom>,
    statusMap: Map<string, SupersessionStatus>,
  ): void {
    const protocolName = this.protocol.name.toLowerCase();

    for (const atom of atoms) {
      const state = atom.protocols.get(protocolName);
      const supersedes = state?.trailers.Supersedes || [];
      if (supersedes.length === 0) {
        continue;
      }

      const visited = new Set<string>();
      visited.add(atom.id);

      const queue: AtomId[] = [...supersedes];

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) {
          continue;
        }
        visited.add(currentId);

        if (!this.protocol.isValidIdentity(currentId)) {
          continue;
        }

        if (statusMap.has(currentId)) {
          const currentStatus = statusMap.get(currentId)!;
          if (!currentStatus.superseded) {
            statusMap.set(currentId, {
              superseded: true,
              supersededBy: atom.id,
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
