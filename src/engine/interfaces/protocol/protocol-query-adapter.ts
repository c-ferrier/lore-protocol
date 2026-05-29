import type { ProtocolState } from '../../types/domain.js';

/**
 * Capability interface for mapping protocol logic to Git queries.
 * Owns discovery patterns and search filtering.
 */
export interface IProtocolQueryAdapter {
  /**
   * Returns the raw regex pattern that identifies a commit belonging to this protocol.
   */
  getDiscoveryPattern(): string;

  /**
   * Get Git grep arguments to find commits belonging to this protocol.
   */
  getDiscoveryGrep(): string[];

  /**
   * Translates generic filters into specific Git grep arguments.
   */
  getSearchGrep(filters: Record<string, string | string[]>): string[];

  /**
   * Returns a Git grep pattern for finding a specific atom by its identity.
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
