import type { LoreAtom, ConfidenceLevel, ScopeRiskLevel, ReversibilityLevel, TrailerKey } from './domain.js';

export type TargetType = 'file' | 'line-range' | 'directory' | 'glob';

export interface QueryTarget {
  readonly raw: string;
  readonly type: TargetType;
  readonly filePath: string;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
}

/**
 * Unified options for all Lore queries (log, search, context, etc.).
 * These options form the identity of a query for caching purposes.
 */
export interface QueryOptions {
  // Discovery Bounds (Git layer)
  readonly since: string | null;
  readonly until: string | null;
  readonly maxCommits: number | null;
  readonly author: string | null;

  // Lore Narrowing Filters (Application layer)
  readonly scope: string | null;
  readonly text: string | null;
  readonly confidence: ConfidenceLevel | null;
  readonly scopeRisk: ScopeRiskLevel | null;
  readonly reversibility: ReversibilityLevel | null;
  readonly has: TrailerKey | null;
  readonly follow: boolean;
  readonly followDepth: number | null;
  readonly all: boolean;

  // Display/Pagination (EXCLUDED from cache key)
  /** Result-level cap applied by the command layer after querying. */
  readonly limit: number | null;
  /** Page number (1-indexed). */
  readonly page: number | null;
}

export interface AtomsResult {
  readonly atoms: readonly LoreAtom[];
  readonly totalCount: number;
  readonly oldest: Date | null;
  readonly newest: Date | null;
}

export interface QueryResult {
  readonly command: string;
  readonly target: string;
  readonly targetType: TargetType | 'search' | 'global';
  readonly atoms: readonly LoreAtom[];
  readonly meta: QueryMeta;
  /** The page number being displayed (1-indexed). */
  readonly page: number;
  /** The page size/limit used for this result. */
  readonly limit: number;
}

export interface QueryMeta {
  readonly totalAtoms: number;
  readonly filteredAtoms: number;
  readonly oldest: Date | null;
  readonly newest: Date | null;
}
