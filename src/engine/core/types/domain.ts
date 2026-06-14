import { ProtocolMap, type ProtocolName } from '../models/protocol-map.js';

export { ProtocolMap };
export type { ProtocolName };

/** String identifying a protocol atom. */
export type AtomId = string;

/**
 * A structured trailer collection for a single scope/namespace.
 * Strictly flat and uniform: every key maps to a readonly string array.
 */
export type Trailers = Record<string, readonly string[]>;

/**
 * A hierarchical collection of trailers grouped by protocol name.
 */
export type HierarchicalTrailers = ReadonlyMap<ProtocolName, Trailers>;


/**
 * The interpreted state of a protocol within a commit.
 * 
 * DESIGN: This is a pure data payload. It does NOT contain protocol metadata 
 * (like name or version) as those are owned by the Protocol Expert.
 */
export interface ProtocolState {
  readonly trailers: Trailers;
  /** Trailers that were associated with this protocol but not authorized by schema */
  readonly unauthorized: Trailers;
  /** References found in trailers that could not be qualified to a logical URI */
  readonly invalidReferences: Trailers;
  /** Internalized supersession status (attached by the repository during discovery) */
  supersession?: SupersessionStatus;
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
  readonly rawTrailers: string; // Original unparsed trailers
  readonly filesChanged: readonly string[];

  /**
   * Interpretations of this commit by different protocols.
   */
  readonly protocols: ProtocolMap<ProtocolState>;
}

/**
 * Calculated supersession metadata for a protocol interpretation.
 * PROJECTED: Attached by the repository during discovery.
 */
export interface SupersessionStatus {
  readonly superseded: boolean;
  /** Identities of atoms that supersede this one (0..n) */
  readonly supersededBy: readonly string[];
}

/** A single staleness signal identified for an atom. */
export interface StaleReason {
  readonly signal: StaleSignal;
  readonly description: string;
}

/** The set of signals that indicate an atom may be stale. */
export type StaleSignal = 'age' | 'drift' | 'orphaned-dep' | string;
