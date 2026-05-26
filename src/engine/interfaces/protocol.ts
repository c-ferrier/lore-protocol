import type { ProtocolState, Atom, SupersessionStatus, StaleReason } from '../types/domain.js';
import type { FormattableTrailerDefinition } from '../types/output.js';
import type { TrailerUiKind, TrailerUiColor, CustomTrailerDefinition } from '../types/config.js';
import type { SearchOptions } from '../types/query.js';

/**
 * Metadata for a protocol trailer, including its origin (core vs custom).
 */
export interface AuthorizedTrailerDefinition extends CustomTrailerDefinition {
  readonly key: string;
  readonly isCore: boolean;
}

/**
 * Interface for a decision protocol (e.g., Lore, Fred).
 * Defines the semantics, identity, and discovery rules for a specific protocol.
 */
export interface IProtocol {
  readonly name: string;
  readonly version: string;
  readonly identityKey: string;

  /**
   * The namespace this protocol operates in.
   * Empty string "" indicates the Root namespace (e.g., Lore).
   * Explicitly namespaced trailers use the format: "Namespace/Key: value".
   */
  readonly namespace: string;

  /**
   * Returns true if the protocol allows ad-hoc (unregistered) trailers.
   */
  readonly permissive: boolean;

  /**
   * Authorizes a trailer key for use.
   * Returns the canonical casing of the key if authorized, otherwise null.
   */
  authorize(key: string): string | null;

  /**
   * Returns the metadata definition for a key.
   */
  getDefinition(key: string): AuthorizedTrailerDefinition | null;

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
   * Returns true if the key belongs to the core protocol.
   */
  isCore(key: string): boolean;

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

  /**
   * Returns true if this protocol explicitly defines/owns the given trailer key.
   */
  owns(key: string): boolean;

  /**
   * Returns the raw regex pattern that identifies a commit belonging to this protocol.
   * e.g., "^atom-id: [0-9a-f]{8}"
   */
  getDiscoveryPattern(): string;

  /**
   * Translates generic filters into specific Git grep arguments.
   * @param filters Key-value pairs to match.
   */
  getSearchGrep(filters: Record<string, string | string[]>): string[];

  /**
   * Application-level check: does this parsed state match the requested filters?
   */
  matches(state: ProtocolState, filters: Record<string, string | string[]>): boolean;

  /**
   * Parse raw trailers into a protocol-specific state.
   * @param rawTrailers Raw trailer text from Git.
   * @param claimedKeys Optional set of keys already claimed by an explicit owner.
   */
  parse(
    rawTrailers: string,
    claimedKeys?: Set<string>,
  ): ProtocolState;

  /**
   * Returns a Git grep pattern for finding a specific atom by its identity.
   * e.g., "lore123" -> "^atom-id: lore123"
   */
  getIdentityPattern(id: string): string;

  /**
   * Check if an ID is valid according to this protocol's rules.
   */
  isValidIdentity(id: string): boolean;

  /**
   * Extracts the identity value from a raw trailer dictionary.
   * Returns null if the trailers object is missing or does not contain a valid identity.
   */
  getIdentity(trailers: Record<string, readonly string[]> | undefined | null): string | null;

  /**
   * Check if a commit's raw trailers belong to this protocol.
   */
  claims(rawTrailers: string): boolean;

  /**
   * Get Git grep arguments to find commits belonging to this protocol.
   */
  getDiscoveryGrep(): string[];

  /**
   * Returns a list of staleness signals identified for an atom.
   * @param atom The atom to analyze.
   * @param now Current date for time-based checks.
   * @param supersessionMap Global supersession context.
   */
  getStaleSignals(
    atom: Atom,
    now: Date,
    supersessionMap: Map<string, SupersessionStatus>,
  ): StaleReason[];
}
