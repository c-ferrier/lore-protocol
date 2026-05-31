import type { ProtocolState } from '../../types/domain.js';
import type { QualifiedFilter } from '../../types/query.js';

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
   * Translates structured filters into high-level regex patterns for storage pushdown.
   * Returns an array of arrays, where top level is AND and inner is OR.
   */
  getSearchPatterns(filters: readonly QualifiedFilter[]): string[][];

  /**
   * Returns a raw regex pattern for finding a specific atom by its identity.
   */
  getIdentityPattern(id: string): string;

  /**
   * Application-level check: does this parsed state match the requested filters?
   * Evaluates all operators (eq, ne, re, gt, lt, etc.) authoritatively.
   */
  matches(state: ProtocolState, filters: readonly QualifiedFilter[]): boolean;

  /**
   * Check if a commit's raw trailers belong to this protocol.
   */
  claims(rawTrailers: string): boolean;
}
