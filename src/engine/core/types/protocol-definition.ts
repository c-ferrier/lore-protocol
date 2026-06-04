import type { TrailerDefinition } from './config.js';
import type { 
    Atom, 
    StaleReason, 
    SupersessionStatus, 
    ProtocolState 
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
 * Functional interface for a Protocol implementation.
 */
export interface IProtocol {
    readonly name: string;
    readonly version: string;
    readonly strict: boolean;
    readonly permissive: boolean;
    readonly identityKey: string;
    readonly storageNamespace: string;

    authorize(key: string): string | null;
    getAuthorizedKeys(): string[];
    getScalarKeys(): string[];
    getListKeys(): string[];
    getReferenceKeys(): string[];
    getDefinition(key: string): TrailerDefinition | null;
    owns(key: string): boolean;
    isRoot(): boolean;
    isValidIdentity(id: string): boolean;
    parse(raw: string, claimedKeys?: Set<string>): ProtocolState;
    normalize(rawMap: Record<string, readonly string[]>, claimedKeys?: Set<string>): ProtocolState;
    getIdentity(state?: ProtocolState | null): string | null;
    validateState(state: ProtocolState, resolver?: IIdentityResolver): ValidationIssue[];
    validateTrailer(key: string, value: string, resolver?: IIdentityResolver): { valid: boolean; message?: string; rule?: string };
    isCore(key: string): boolean;
    matches(state: ProtocolState, filters: readonly QualifiedFilter[]): boolean;
    getFormattableDefinitions(): Record<string, FormattableTrailerDefinition>;
    getStaleSignals(atom: Atom, now: Date, globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>): StaleReason[];
}

/**
 * Static definition for a protocol's metadata and schema.
 * Allows protocols to be defined as pluggable objects.
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
