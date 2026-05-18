import type { QueryOptions } from '../types/query.js';

/**
 * Interface for the Query Cache.
 * Caches the final filtered list of git hashes for a given query intent.
 */
export interface IQueryCache {
  /**
   * Retrieve cached hashes for a query.
   * @param headHash The 40-char HEAD commit hash.
   * @param gitLogArgs The path-resolution arguments (files/dirs).
   * @param options The Lore-specific query filters.
   */
  get(
    headHash: string,
    gitLogArgs: readonly string[],
    options: QueryOptions,
  ): Promise<readonly string[] | null>;

  /**
   * Persist the final filtered result set.
   */
  set(
    headHash: string,
    gitLogArgs: readonly string[],
    options: QueryOptions,
    hashes: readonly string[],
  ): Promise<void>;

  /**
   * Perform deferred cleanup of old cache files.
   */
  prune(): Promise<void>;
}
