/** 8-character hex string identifying a protocol atom. */
export type AtomId = string;

/**
 * The structured trailer collection for a single scope/namespace.
 * Strictly flat and uniform: every key maps to a readonly string array.
 */
export type Trailers = Record<string, readonly string[]>;

/**
 * A hierarchical collection of trailers grouped by namespace.
 * Keyed by namespace name (use "" for root namespace).
 */
export type HierarchicalTrailers = Record<string, Trailers>;

/**
 * The interpreted state of a protocol within a commit.
 */
export interface ProtocolState {
  readonly name: string;
  readonly version: string;
  readonly identityKey: string;
  readonly trailers: Trailers;
  /** Trailers that were associated with this protocol but not authorized by schema */
  readonly unauthorized: Trailers;
}

/**
 * A decision atom discovered in git history.
 * Represents a commit that has been interpreted by one or more protocols.
 */
export interface Atom {
  readonly commitHash: string;
  readonly date: Date;
  readonly author: string;
  readonly subject: string; // The commit subject line
  readonly body: string;    // Body text (trailers stripped)
  readonly filesChanged: readonly string[];

  /**
   * Interpretations of this commit by different protocols.
   * Keyed by protocol name (lowercase).
   */
  readonly protocols: Map<string, ProtocolState>;
}

export interface SupersessionStatus {
  readonly superseded: boolean;
  readonly supersededBy: AtomId | null;
}

/** A single staleness signal identified for an atom. */
export interface StaleReason {
  readonly signal: StaleSignal;
  readonly description: string;
}

/** The set of signals that indicate an atom may be stale. */
export type StaleSignal = 'age' | 'drift' | 'orphaned-dep' | string;
