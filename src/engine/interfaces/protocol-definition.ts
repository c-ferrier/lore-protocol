import type { TrailerDefinition } from '../types/config.js';
import type { Atom, StaleReason, SupersessionStatus } from '../types/domain.js';

/**
 * Static definition for a protocol's metadata and schema.
 * Allows protocols to be defined as pluggable objects.
 */
export interface ProtocolDefinition {
  readonly name: string;
  readonly version: string;
  readonly strict: boolean;
  readonly permissive: boolean;
  /** Empty string "" indicates root namespace */
  readonly namespace: string;
  readonly identityKey: string;
  readonly trailers: Record<string, TrailerDefinition>;

  /**
   * Optional hook to identify staleness signals for an atom.
   */
  readonly getStaleSignals?: (
    atom: Atom,
    now: Date,
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>,
  ) => StaleReason[];
}
