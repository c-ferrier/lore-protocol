/**
 * Interface for the Persistent Identity Index.
 * Maps fully-qualified protocol identities (e.g. 'lore/abc1234') to 
 * known Git commit hashes where they have been seen.
 * 
 * Unlike the QueryCache, this index is not bound to a specific HEAD 
 * and persists across branch switches.
 */
export interface IIdentityIndex {
  /**
   * Retrieves all known hashes for a qualified identity.
   */
  get(qualifiedId: string): Promise<string[]>;

  /**
   * Records a new location for a qualified identity.
   */
  append(qualifiedId: string, hash: string): Promise<void>;

  /**
   * Clears the index.
   */
  clear(): Promise<void>;
}
