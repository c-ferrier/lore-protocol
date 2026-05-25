export interface AtomCacheEntry {
  readonly filesChanged: readonly string[];
}

export interface IAtomCache {
  /**
   * Get cached metadata for a commit hash.
   * Returns null if not in cache.
   */
  get(hash: string): Promise<AtomCacheEntry | null>;

  /**
   * Cache metadata for a commit hash.
   */
  set(hash: string, entry: AtomCacheEntry): Promise<void>;
}
