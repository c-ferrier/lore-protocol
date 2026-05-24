import type { Atom } from './domain.js';

export type TargetType = 'file' | 'line-range' | 'directory' | 'glob';

export interface QueryTarget {
  readonly raw: string;
  readonly type: TargetType;
  readonly filePath: string;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
}

export interface PathQueryOptions {
  readonly scope: string | null;
  readonly follow: boolean;
  readonly all: boolean;
  readonly author: string | null;
  /** Result-level cap applied by the command layer after querying. Not used by the repository. */
  readonly limit: number | null;
  /** Page number for results (1-indexed). Not used by the repository. */
  readonly page?: number | null;
  readonly maxCommits: number | null;
  readonly since: string | null;
  readonly until: string | null;
}

/**
 * Enhanced options for cross-cutting search queries.
 * Pushes coarse filtering down to the Git layer where possible.
 */
export interface SearchOptions extends PathQueryOptions {
  /** Generic trailer filters: key -> value(s) to match */
  readonly filters?: Record<string, string | string[]>;
  /** Trailer presence filter (any value) */
  readonly has: string | null;
  /** Full-text search across intent, body, and trailers */
  readonly text: string | null;

  /** Pre-resolved date for the authoritative application-level filter pass. */
  readonly sinceDate?: Date | null;
  /** Pre-resolved date for the authoritative application-level filter pass. */
  readonly untilDate?: Date | null;
}

/**
 * Unified options for all Lore queries (log, search, context, etc.).
 * These options form the identity of a query for caching purposes.
 */
export type QueryOptions = SearchOptions;

export interface QueryResult {
  readonly command: string;
  readonly target: string;
  readonly targetType: TargetType | 'search' | 'global';
  readonly atoms: readonly Atom[];
  readonly meta: QueryMeta;
}

export interface QueryMeta {
  readonly totalAtoms: number;
  readonly filteredAtoms: number;
  readonly oldest: Date | null;
  readonly newest: Date | null;
}
