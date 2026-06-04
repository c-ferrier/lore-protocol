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

    // Logic Hooks (allows mocking in tests while defaulting to pure logic)
    validateState(state: ProtocolState, resolver?: IIdentityResolver): ValidationIssue[];
    validateTrailer(key: string, value: string, resolver?: IIdentityResolver): { valid: boolean; message?: string; rule?: string };
    getStaleSignals(atom: Atom, now: Date, globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>): StaleReason[];
    getAuthorizedKeys(): string[];
}

/**
 * Domain model for a Protocol.
 * Combines optimized context with behavioral methods.
 */
export interface IProtocol extends ProtocolContext {
    readonly context: ProtocolContext;
    
    authorize(key: string): string | null;
    isValidIdentity(id: string): boolean;
    getIdentity(state?: ProtocolState | null): string | null;
    getAuthorizedKeys(): string[];
    getQualifiedKey(key: string): string;
    isBucketOwner(key: string): boolean;
    owns(key: string): boolean;
    normalize(rawMap: Record<string, readonly string[]>, claimedKeys?: Set<string>): ProtocolState;
    validateState(state: ProtocolState, resolver?: IIdentityResolver): ValidationIssue[];
    validateTrailer(key: string, value: string, resolver?: IIdentityResolver): { valid: boolean; message?: string; rule?: string };
    getFormattableDefinitions(): Record<string, FormattableTrailerDefinition>;
    getStaleSignals(atom: Atom, now: Date, globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>): StaleReason[];
}
