import type { ProtocolState, Atom, SupersessionStatus, StaleReason, Trailers } from '../../types/domain.js';

/**
 * Capability interface for interpreting data into protocol state.
 * Owns parsing, normalization, and identity extraction.
 */
export interface IProtocolInterpreter {
  /**
   * Parse raw trailers into a protocol-specific state.
   */
  parse(
    rawTrailers: string,
    claimedKeys?: Set<string>,
    includeInvalid?: boolean,
  ): ProtocolState;

  /**
   * Normalizes a raw collection of trailers into a structured protocol state.
   * Categorizes trailers into "authorized" and "unauthorized" buckets.
   */
  normalize(trailers: Trailers, claimedKeys?: Set<string>): ProtocolState;

  /**
   * Extracts the identity value from a protocol state.
   */
  getIdentity(state?: ProtocolState | null): string | null;

  /**
   * Check if an ID is valid according to this protocol's rules.
   */
  isValidIdentity(id: string): boolean;

  /**
   * Returns a list of staleness signals identified for an atom.
   */
  getStaleSignals(
    atom: Atom,
    now: Date,
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>,
  ): StaleReason[];
}
