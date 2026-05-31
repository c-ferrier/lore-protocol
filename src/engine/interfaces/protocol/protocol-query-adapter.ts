import type { ProtocolState } from '../../types/domain.js';

/**
 * Capability interface for mapping protocol logic to Git queries.
 * Owns discovery patterns and search filtering.
 */
export interface IProtocolQueryAdapter {
  /**
   * Returns a list of regex patterns. If multiple patterns are returned, 
   * they are treated as an OR set.
   */
  getDiscoveryPatterns(): string[];

  /**
   * Translates generic filters into high-level regex patterns.
   * Returns an array of arrays, where top level is AND and inner is OR.
   */
  getSearchPatterns(filters: Record<string, string | string[]>): string[][];

  /**
   * Returns a raw regex pattern for finding a specific atom by its identity.
   */
  getIdentityPattern(id: string): string;

  /**
   * Application-level check: does this parsed state match the requested filters?
   */
  matches(state: ProtocolState, filters: Record<string, string | string[]>): boolean;

  /**
   * Check if a commit's raw trailers belong to this protocol.
   */
  claims(rawTrailers: string): boolean;
}
