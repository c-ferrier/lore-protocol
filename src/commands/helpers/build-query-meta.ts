import type { LoreAtom } from '../../types/domain.js';
import type { QueryMeta } from '../../types/query.js';

/**
 * Build QueryMeta from a set of atoms and pre-calculated date bounds.
 *
 * @param totalAtoms - Count before any result-level limiting (e.g., --limit)
 * @param displayAtoms - The atoms that will actually be shown to the user
 * @param bounds - Mandatory oldest/newest dates representing the entire result set
 */
export function buildQueryMeta(
  totalAtoms: number,
  displayAtoms: readonly LoreAtom[],
  bounds: { oldest: Date | null; newest: Date | null },
): QueryMeta {
  return {
    totalAtoms,
    filteredAtoms: displayAtoms.length,
    oldest: bounds.oldest,
    newest: bounds.newest,
  };
}
