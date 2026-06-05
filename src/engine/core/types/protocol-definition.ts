import type {TrailerDefinition } from './config.js';
import type { QueryIdentity } from './query.js';

/**
 * Interface for resolving identities across protocols.
 */
export interface IIdentityResolver {
    resolveIdentity(val: string, currentProtocol: string): QueryIdentity;
    get(name: string): ProtocolContext | undefined;
}

/**
 * Static definition for a protocol's metadata and schema.
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
}

/**
 * Operationally optimized view of a Protocol.
 * Created once per protocol at bootstrap to avoid repetitive casing/string math.
 */
export interface ProtocolContext {
    readonly def: ProtocolDefinition;
    /** Map of lowercased_key -> CanonicalKey from schema */
    readonly caseMap: Map<string, string>;
    readonly isRoot: boolean;
    /** "Namespace: " or "" */
    readonly storagePrefix: string;
    /** Map of hydrated trailer definitions indexed by canonical key */
    readonly trailers: Map<string, TrailerDefinition & { key: string }>;

    // Convenience properties
    readonly name: string;
    readonly version: string;
    readonly strict: boolean;
    readonly permissive: boolean;
    readonly identityKey: string;
    readonly storageNamespace: string;
}
