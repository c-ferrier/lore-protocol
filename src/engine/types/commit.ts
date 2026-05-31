import type { HierarchicalTrailers } from './domain.js';

/**
 * The structured input for creating a atom.
 */
export interface CommitInput {
  readonly subject: string;
  readonly body?: string;
  /** 
   * Unified hierarchical trailers grouped by protocol name (lowercase).
   */
  readonly trailers: HierarchicalTrailers;
}
