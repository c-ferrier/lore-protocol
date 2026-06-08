import { ProtocolMap, type HierarchicalTrailers, type ProtocolState } from './domain.js';

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

/**
 * The result of a commit formatting operation.
 * Contains the final message for Git and the interpreted engine state.
 */
export interface PreparedCommit {
  readonly message: string;
  readonly subject: string;
  readonly body: string;
  readonly protocols: ProtocolMap<ProtocolState>;
}
