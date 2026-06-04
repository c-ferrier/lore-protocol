import type { TrailerDefinition, StaleIfCondition } from './config.js';
import type { 
    ProtocolState, 
    Atom,
    SupersessionStatus,
    StaleReason,
} from './domain.js';
import type { ValidationIssue, FormattableTrailerDefinition } from './output.js';
import type { QualifiedFilter, QueryIdentity } from './query.js';

/**
 * Interface for resolving identities across protocols.
 */
export interface IIdentityResolver {
    resolveIdentity(val: string, currentProtocol: string): QueryIdentity;
    get(name: string): IProtocol | undefined;
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
}

/**
 * Domain model for a Protocol.
 * Combines optimized context with behavioral methods.
 */
export interface IProtocol extends ProtocolContext {
    readonly name: string;
    readonly version: string;
    readonly strict: boolean;
    readonly permissive: boolean;
    readonly identityKey: string;
    readonly storageNamespace: string;
    
    authorize(key: string): string | null;
    isValidIdentity(id: string): boolean;
    getIdentity(state?: ProtocolState | null): string | null;
    getAuthorizedKeys(): string[];
    getScalarKeys(): string[];
    getListKeys(): string[];
    getReferenceKeys(): string[];
    getDefinition(key: string): TrailerDefinition | null;
    getStoragePrefix(): string;
    getQualifiedKey(key: string): string;
    isBucketOwner(key: string): boolean;
    owns(key: string): boolean;
    isRootProtocol(): boolean;
    normalize(rawMap: Record<string, readonly string[]>, claimedKeys?: Set<string>): ProtocolState;
    validateState(state: ProtocolState, resolver?: IIdentityResolver): ValidationIssue[];
    validateTrailer(key: string, value: string, resolver?: IIdentityResolver): { valid: boolean; message?: string; rule?: string };
    isCore(key: string): boolean;
    matches(state: ProtocolState, filters: readonly QualifiedFilter[]): boolean;
    claims(raw: string): boolean;
    getDiscoveryPatterns(): string[];
    getSearchPatterns(filters: readonly QualifiedFilter[]): string[][];
    getFormattableDefinitions(): Record<string, FormattableTrailerDefinition>;
    getStaleSignals(atom: Atom, now: Date, globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>): StaleReason[];
}
