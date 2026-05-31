/** 8-character hex string identifying a protocol atom. */
export type AtomId = string;

/** Logical identifier for a protocol (e.g. 'lore', 'project') */
export type ProtocolName = string;

/**
 * A Map that automatically normalizes ProtocolName keys to lowercase.
 */
export class ProtocolMap<V> extends Map<ProtocolName, V> {
  override get(key: ProtocolName): V | undefined {
    return super.get(key.toLowerCase());
  }
  override set(key: ProtocolName, value: V): this {
    return super.set(key.toLowerCase(), value);
  }
  override has(key: ProtocolName): boolean {
    return super.has(key.toLowerCase());
  }
  override delete(key: ProtocolName): boolean {
    return super.delete(key.toLowerCase());
  }
}

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
   */
  readonly protocols: ProtocolMap<ProtocolState>;
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
