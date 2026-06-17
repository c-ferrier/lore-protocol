import type { QueryOptions } from '../core/types/query.js';

/**
 * Interface for the Query Cache.
 * Caches the final filtered list of git hashes for a given query subject.
 * This allows the Engine to skip even the "Coarse" Git discovery pass if the HEAD has not changed.
 *
 * GRASP: Pure Fabrication -- caching is a technical concern.
 */
export interface IQueryCache {
  /**
   * Retrieve cached hashes for a query.
   * @param headHash The 40-char HEAD commit hash.
   * @param targetFingerprint A unique, stable string representing the query target (e.g. from QueryTargetAST).
   * @param options The engine-specific query options (filters, text, etc.).
   * @returns List of matching commit hashes, or null if not in cache.
   */
  get(
    headHash: string,
    targetFingerprint: string,
    options: QueryOptions,
  ): Promise<readonly string[] | null>;

  /**
   * Persist the final filtered result set (commit hashes).
   */
  set(
    headHash: string,
    targetFingerprint: string,
    options: QueryOptions,
    hashes: readonly string[],
  ): Promise<void>;

  /**
   * Perform cleanup of old cache files.
   * Purges all entries that do not start with any of the provided `keepHashes`.
   * Commonly used with the current HEAD hash to invalidate old branch/rebase data.
   */
  prune(keepHashes: readonly string[]): Promise<void>;

  /**
   * Completely clear the query cache directory.
   */
  clear(): Promise<void>;
}
