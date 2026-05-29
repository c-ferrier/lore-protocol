import type { TrailerUiKind, TrailerUiColor } from '../../types/config.js';
import type { FormattableTrailerDefinition } from '../../types/output.js';
import type { ActiveTrailer } from '../protocol.js';

/**
 * Capability interface for protocol schema management.
 * Owns definitions, authorization, and semantic metadata.
 */
export interface IProtocolSchema {
  /**
   * Returns true if this protocol explicitly defines/owns the given trailer key.
   */
  owns(key: string): boolean;

  /**
   * Returns true if the key belongs to the core protocol.
   */
  isCore(key: string): boolean;

  /**
   * Authorizes a trailer key for use.
   * Returns the canonical casing of the key if authorized, otherwise null.
   */
  authorize(key: string): string | null;

  /**
   * Returns the metadata definition for a key.
   */
  getDefinition(key: string): ActiveTrailer | null;

  /**
   * Returns all authorized keys (Core + Custom) sorted by prompt priority.
   */
  getAuthorizedKeys(): string[];

  /**
   * Returns all authorized keys for this protocol.
   */
  getAllKeys(): string[];

  /**
   * Returns all keys that are defined as scalar (single-value).
   */
  getScalarKeys(): string[];

  /**
   * Returns all keys that are defined as lists (multi-value).
   */
  getListKeys(): string[];

  /**
   * Returns all keys that reference other atoms.
   */
  getReferenceKeys(): string[];

  /**
   * Returns the semantic UI kind for a trailer.
   */
  getUiKind(key: string): TrailerUiKind;

  /**
   * Returns the semantic color for a trailer.
   */
  getUiColor(key: string): TrailerUiColor;

  /**
   * Returns a unified view of all trailer definitions for UI rendering.
   */
  getFormattableDefinitions(): Record<string, FormattableTrailerDefinition>;
}
