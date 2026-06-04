import { ProtocolMap, type ProtocolName } from './protocol-map.js';
import type { 
    ProtocolDefinition, 
    ProtocolContext,
    IIdentityResolver, 
    IProtocol 
} from '../types/protocol-definition.js';
import type { 
    TrailerDefinition, 
} from '../types/config.js';
import type { 
    ProtocolState, 
    Atom,
    SupersessionStatus,
    StaleReason,
} from '../types/domain.js';
import type { ValidationIssue } from '../types/output.js'
import type { FormattableTrailerDefinition } from '../types/output.js';
import type { QualifiedFilter } from '../types/query.js';
import { TriggerParser } from '../../util/trigger-parser.js';

import { 
    validateProtocolState, 
    validateProtocolTrailer, 
    isValidProtocolIdentity 
} from '../logic/validation.js';

import { 
    createProtocolContext,
    getAuthorizedKeys,
    getScalarKeys,
    getListKeys,
    getReferenceKeys,
    isCoreTrailer,
    getFormattableDefinitions
} from '../logic/protocols.js';
import { getQualifiedKey, isBucketOwner, ownsKey, authorizeKey } from '../logic/ownership.js';
import { normalizeTrailers } from '../logic/normalization.js';

import { 
    getDiscoveryPatterns, 
    getSearchPatterns, 
    matchesFilters, 
    claimsTrailers 
} from '../../shell/git/protocol-query-adapter.js';

import { 
    getProtocolStaleSignals,
} from '../logic/staleness.js';

export type ActiveTrailer = TrailerDefinition & { key: string };

/**
 * Functional model of a Protocol in the Atom Engine.
 * 
 * Responsibility: Provide a backward-compatible class interface that 
 * delegates all 'Judgment Brain' logic to stateless pure functions.
 * 
 * Satisfies ProtocolContext and IProtocol to allow seamless transition.
 */
export class ActiveProtocol implements IProtocol, ProtocolContext {
  public readonly name: string;
  public readonly version: string;
  public readonly strict: boolean;
  public readonly permissive: boolean;
  public readonly identityKey: string;
  public readonly storageNamespace: string;

  // ProtocolContext implementation
  public readonly def: ProtocolDefinition;
  public readonly caseMap: Map<string, string>;
  public readonly isRoot: boolean;
  public readonly storagePrefix: string;
  /** Map of hydrated trailer definitions indexed by canonical key */
  public readonly trailers: Map<string, TrailerDefinition & { key: string }>;

  constructor(
    definition: ProtocolDefinition
  ) {
    this.def = definition;
    this.name = definition.name.toLowerCase();
    this.version = definition.version;
    this.strict = definition.strict ?? true;
    this.permissive = definition.permissive ?? false;
    this.identityKey = definition.identityKey;
    this.storageNamespace = definition.namespace || '';
    
    const ctx = createProtocolContext(definition);
    this.caseMap = ctx.caseMap;
    this.isRoot = ctx.isRoot;
    this.storagePrefix = ctx.storagePrefix;
    this.trailers = ctx.trailers;
  }

  /**
   * Helper to satisfy IProtocol.context while being the context itself.
   */
  public get context(): ProtocolContext {
      return this;
  }

  /**
   * Translates a raw key into its canonical, schema-defined case.
   */
  authorize(key: string): string | null {
    return authorizeKey(key, this);
  }

  /**
   * Returns all trailer keys explicitly defined in the protocol schema.
   */
  getAuthorizedKeys(): string[] {
    return getAuthorizedKeys(this);
  }

  getScalarKeys(): string[] {
    return getScalarKeys(this);
  }

  getListKeys(): string[] {
    return getListKeys(this);
  }

  getDefinition(key: string): TrailerDefinition | null {
    return this.trailers.get(key) || null;
  }

  getReferenceKeys(): string[] {
    return getReferenceKeys(this);
  }

  getStoragePrefix(): string {
    return this.storagePrefix;
  }

  getQualifiedKey(key: string): string {
    return getQualifiedKey(key, this);
  }

  isBucketOwner(key: string): boolean {
    return isBucketOwner(key, this);
  }

  owns(key: string): boolean {
    return ownsKey(key, this);
  }

  isRootProtocol(): boolean {
    return this.isRoot;
  }

  isValidIdentity(id: string): boolean {
    return isValidProtocolIdentity(id, this.def);
  }

  parse(raw: string, claimedKeys?: Set<string>): ProtocolState {
    const rawMap = TriggerParser.parseTrailers(raw);
    return this.normalize(rawMap, claimedKeys);
  }

  normalize(rawMap: Record<string, readonly string[]>, claimedKeys?: Set<string>): ProtocolState {
    return normalizeTrailers(rawMap, this, claimedKeys);
  }

  getIdentity(state?: ProtocolState | null): string | null {
    if (!state) return null;
    const values = state.trailers[this.identityKey];
    if (!values || values.length === 0) return null;
    return values[0];
  }

  validateState(state: ProtocolState, resolver?: IIdentityResolver): ValidationIssue[] {
    return validateProtocolState(state, this.def, resolver);
  }

  validateTrailer(key: string, value: string, resolver?: IIdentityResolver): { valid: boolean; message?: string; rule?: string } {
    return validateProtocolTrailer(key, value, this.def, resolver);
  }

  isCore(key: string): boolean {
    return isCoreTrailer(key, this);
  }

  matches(state: ProtocolState, filters: readonly QualifiedFilter[]): boolean {
    return matchesFilters(state, filters, this);
  }

  claims(raw: string): boolean {
    return claimsTrailers(raw, this);
  }

  getDiscoveryPatterns(): string[] {
    return getDiscoveryPatterns(this);
  }

  getSearchPatterns(filters: readonly QualifiedFilter[]): string[][] {
    return getSearchPatterns(filters, this);
  }

  getFormattableDefinitions(): Record<string, FormattableTrailerDefinition> {
    return getFormattableDefinitions(this);
  }

  getStaleSignals(
    atom: Atom,
    now: Date,
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>,
  ): StaleReason[] {
    return getProtocolStaleSignals(this, atom, now, globalSupersessionMap);
  }
}
