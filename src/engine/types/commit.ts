import type { Trailers } from './domain.js';

/**
 * The structured input for creating a atom.
 * Maps directly to the uniform domain model.
 */
export interface CommitInput {
  readonly subject: string;
  readonly body?: string;
  readonly trailers?: Trailers;
}
