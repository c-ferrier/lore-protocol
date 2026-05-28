import type { HierarchicalTrailers } from './domain.js';

/**
 * The structured input for creating a atom.
 */
export interface CommitInput {
  readonly subject: string;
  readonly body?: string;
  /** 
   * Unified hierarchical trailers grouped by namespace.
   * Use "" as key for root namespace.
   */
  readonly trailers: HierarchicalTrailers;
}
