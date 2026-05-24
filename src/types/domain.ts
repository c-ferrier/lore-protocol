import { STALE_SIGNALS, LORE_TRAILER_KEYS, ARRAY_TRAILER_KEYS, ENUM_TRAILER_KEYS, CONFIDENCE_VALUES, SCOPE_RISK_VALUES, REVERSIBILITY_VALUES } from '../util/core-definitions.js';

/** 8-character hex string identifying a protocol atom. */
export type AtomId = string;

/** The set of recognized trailer keys. */
export type TrailerKey = (typeof LORE_TRAILER_KEYS)[number];

/** Trailer keys that contain arrays of values. */
export type ArrayTrailerKey = (typeof ARRAY_TRAILER_KEYS)[number];

/** Trailer keys that contain a single enum value. */
export type EnumTrailerKey = (typeof ENUM_TRAILER_KEYS)[number];

/** Valid confidence levels. */
export type ConfidenceLevel = (typeof CONFIDENCE_VALUES)[number];

/** Valid scope-risk levels. */
export type ScopeRiskLevel = (typeof SCOPE_RISK_VALUES)[number];

/** Valid reversibility levels. */
export type ReversibilityLevel = (typeof REVERSIBILITY_VALUES)[number];

/**
 * The structured trailer collection for a protocol atom.
 * Strictly flat and uniform: every key maps to a readonly string array.
 */
export type Trailers = Record<string, readonly string[]>;

/**
 * The interpreted state of a protocol within a commit.
 */
export interface ProtocolState {
  readonly name: string;
  readonly version: string;
  readonly identityKey: string;
  readonly trailers: Trailers;
}

/**
 * A decision atom discovered in git history.
 * Represents a commit that has been interpreted by one or more protocols.
 */
export interface Atom {
  readonly commitHash: string;
  readonly date: Date;
  readonly author: string;
  readonly intent: string; // Subject line
  readonly body: string;   // Body text (trailers stripped)
  readonly filesChanged: readonly string[];

  /**
   * Interpretations of this commit by different protocols.
   * Keyed by protocol name (lowercase).
   */
  readonly protocols: Map<string, ProtocolState>;

  /** @deprecated Use protocols.get('lore').trailers[identityKey][0] */
  readonly loreId: AtomId;
  /** @deprecated Use protocols.get('lore').trailers */
  readonly trailers: Trailers;
}

export interface SupersessionStatus {
  readonly superseded: boolean;
  readonly supersededBy: AtomId | null;
}

/** The set of signals that indicate an atom may be stale. */
export type StaleSignal = (typeof STALE_SIGNALS)[number];
