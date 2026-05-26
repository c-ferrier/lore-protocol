import type { QueryOptions } from '../types/query.js';

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
   * @param gitLogArgs The path-resolution arguments (files/dirs).
   * @param options The Mock-specific query filters.
   * @returns List of matching commit hashes, or null if not in cache.
   */
  get(
    headHash: string,
    gitLogArgs: readonly string[],
    options: QueryOptions,
  ): Promise<readonly string[] | null>;

  /**
   * Persist the final filtered result set (commit hashes).
   */
  set(
    headHash: string,
    gitLogArgs: readonly string[],
    options: QueryOptions,
    hashes: readonly string[],
  ): Promise<void>;

  /**
   * Perform deferred cleanup of old cache files based on LRU (atime).
   */
  prune(): Promise<void>;
}
