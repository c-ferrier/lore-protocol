/** 8-character hex string identifying a protocol atom. */
export type AtomId = string;

/** The set of recognized trailer keys. */
export type TrailerKey = string;

/** Trailer keys that contain arrays of values. */
export type ArrayTrailerKey = string;

/** Trailer keys that contain a single enum value. */
export type EnumTrailerKey = string;

/** Valid confidence levels. */
export type ConfidenceLevel = string;

/** Valid scope-risk levels. */
export type ScopeRiskLevel = string;

/** Valid reversibility levels. */
export type ReversibilityLevel = string;

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

  /** 
   * The primary identifier for this atom.
   * Usually resolved from the root protocol.
   */
  readonly id: AtomId;
}

export interface SupersessionStatus {
  readonly superseded: boolean;
  readonly supersededBy: AtomId | null;
}

/** The set of signals that indicate an atom may be stale. */
export type StaleSignal = 'age' | 'drift' | 'low-confidence' | 'expired-hint' | 'orphaned-dep';
