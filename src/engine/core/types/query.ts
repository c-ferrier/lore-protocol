import type { Atom } from './domain.js';

export interface QueryIdentity {
  readonly id: string;
  readonly protocol?: string;
}

export type QueryTargetType = 'global' | 'path' | 'line-range' | 'identity';

/**
 * Represents a resolved physical query space (Global, Path, or Line-Range).
 * Encapsulates the logic of how to scope the storage-layer discovery.
 * 
 * DESIGN: This is an "Opaque Handle". It hides the complexity of 
 * path resolution, relative-to-root calculation, and line-range parsing.
 */
export interface QueryTargetAST {
  /** The original user input (e.g. "src/main.ts:10" or ["file1", "file2"]). */
  readonly raw: string | readonly string[];

  /** The logical target category. */
  readonly type: QueryTargetType;

  /** Physical paths relative to the Protocol Root. */
  readonly resolvedPaths: readonly string[];

  /** Line-range details if applicable. */
  readonly lineRange?: { file: string; start: number; end: number } | null;

  /** Specific identities to look for. */
  readonly identities?: readonly QueryIdentity[];
}

export interface PathQueryOptions {
  /** Structured trailer filters (AST) or legacy flat map (to be normalized). */
  readonly filters?: readonly QualifiedFilter[] | Record<string, any>;
  readonly scope?: string | null;
  readonly follow?: boolean;
  /** Maximum recursion depth for transitive link following. */
  readonly maxDepth?: number | null;
  readonly all?: boolean;
  readonly author?: string | null;
  /** Result-level cap applied by the command layer after querying. Not used by the repository. */
  readonly limit?: number | null;
  /** Page number for results (1-indexed). Not used by the repository. */
  readonly page?: number | null;
  readonly maxCommits?: number | null;
  readonly since?: string | null;
  readonly until?: string | null;
  /** Whether to use the query cache. Defaults to true. */
  readonly cache?: boolean;
}

/**
 * Supported logical operations for search filters.
 */
export type FilterOperator = 
  | 'eq'    // Equals (default)
  | 'has';  // Key presence (existence)

/**
 * A structured filter that can be explicitly routed to a specific protocol.
 */
export interface QualifiedFilter {
  /** The name of the target protocol (e.g. "lore", "project"), or null for "any". */
  readonly protocol: string | null;
  /** The trailer key (e.g. "Status", "Priority"). */
  readonly key: string;
  /** The logical operation to perform. */
  readonly op: FilterOperator;
  /** The comparison value (literal, array of values, or regex string). */
  readonly value: any;
}

/**
 * Enhanced options for cross-cutting search queries.
 * Pushes coarse filtering down to the Git layer where possible.
 */
export interface SearchOptions extends PathQueryOptions {
  /** Trailer presence filter (any value) */
  readonly has?: string | null;
  /** Full-text search across intent, body, and trailers */
  readonly text?: string | null;

  /** Pre-resolved date for the authoritative application-level filter pass. */
  readonly sinceDate?: Date | null;
  /** Pre-resolved date for the authoritative application-level filter pass. */
  readonly untilDate?: Date | null;
}

/**
 * Unified options for all discovery queries (log, search, context, etc.).
 * These options form the identity of a query for caching purposes.
 */
export type QueryOptions = SearchOptions;

export interface QueryResult {
  readonly command: string;
  readonly target: string;
  readonly targetType: QueryTargetType | 'search';
  readonly atoms: readonly Atom[];
  readonly meta: QueryMeta;
}

export interface QueryMeta {
  readonly totalAtoms: number;
  readonly filteredAtoms: number;
  readonly oldest: Date | null;
  readonly newest: Date | null;
}
