import type { CustomTrailerDefinition } from '../types/config.js';

/**
 * Static definition for a protocol's metadata and schema.
 * Allows protocols to be defined as pluggable objects.
 */
export interface ProtocolDefinition {
  readonly name: string;
  readonly version: string;
  /** Empty string "" indicates root namespace */
  readonly namespace: string;
  readonly identityKey: string;
  readonly trailers: Record<string, CustomTrailerDefinition>;
}
