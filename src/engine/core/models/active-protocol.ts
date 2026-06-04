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
    isValidProtocolIdentity 
} from '../logic/validation.js';

import { 
    createProtocolContext,
    getProtocolAuthorizedKeys,
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

import { getProtocolIdentity } from '../logic/identity.js';

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
    
    const ctx = createProtocolContext(definition);
    this.name = ctx.name;
    this.version = ctx.version;
    this.strict = ctx.strict;
    this.permissive = ctx.permissive;
    this.identityKey = ctx.identityKey;
    this.storageNamespace = ctx.storageNamespace;
    
    this.caseMap = ctx.caseMap;
    this.isRoot = ctx.isRoot;
    this.storagePrefix = ctx.storagePrefix;
    this.trailers = ctx.trailers;
    
    // Satisfy functional hooks from context
    this.validateState = ctx.validateState;
    this.validateTrailer = ctx.validateTrailer;
    this.getStaleSignals = ctx.getStaleSignals;
    this.getAuthorizedKeys = ctx.getAuthorizedKeys;
  }

  /**
   * Helper to satisfy IProtocol.context while being the context itself.
   */
  public get context(): ProtocolContext {
      return this;
  }

  /**
   * ALL methods check this.def for mock overrides first to support legacy tests.
   */

  authorize(key: string): string | null {
    if ((this.def as any).authorize) return (this.def as any).authorize(key);
    return authorizeKey(key, this);
  }

  getQualifiedKey(key: string): string {
    if ((this.def as any).getQualifiedKey) return (this.def as any).getQualifiedKey(key);
    return getQualifiedKey(key, this);
  }

  isBucketOwner(key: string): boolean {
    if ((this.def as any).isBucketOwner) return (this.def as any).isBucketOwner(key);
    return isBucketOwner(key, this);
  }

  owns(key: string): boolean {
    if ((this.def as any).owns) return (this.def as any).owns(key);
    return ownsKey(key, this);
  }

  isValidIdentity(id: string): boolean {
    if ((this.def as any).isValidIdentity) return (this.def as any).isValidIdentity(id);
    return isValidProtocolIdentity(id, this.def);
  }

  parse(raw: string, claimedKeys?: Set<string>): ProtocolState {
    const rawMap = TriggerParser.parseTrailers(raw);
    return this.normalize(rawMap, claimedKeys);
  }

  normalize(rawMap: Record<string, readonly string[]>, claimedKeys?: Set<string>): ProtocolState {
    if ((this.def as any).normalize) return (this.def as any).normalize(rawMap, claimedKeys);
    return normalizeTrailers(rawMap, this, claimedKeys);
  }

  getIdentity(state?: ProtocolState | null): string | null {
    if ((this.def as any).getIdentity) return (this.def as any).getIdentity(state);
    return getProtocolIdentity(state, this);
  }

  // Functional hooks (initialized in constructor)
  validateState: (state: ProtocolState, resolver?: IIdentityResolver) => ValidationIssue[];
  validateTrailer: (key: string, value: string, resolver?: IIdentityResolver) => { valid: boolean; message?: string; rule?: string };
  getStaleSignals: (atom: Atom, now: Date, globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>) => StaleReason[];
  getAuthorizedKeys: () => string[];

  matches(state: ProtocolState, filters: readonly QualifiedFilter[]): boolean {
    if ((this.def as any).matches) return (this.def as any).matches(state, filters);
    return matchesFilters(state, filters, this);
  }

  claims(raw: string): boolean {
    if ((this.def as any).claims) return (this.def as any).claims(raw);
    return claimsTrailers(raw, this);
  }

  getDiscoveryPatterns(): string[] {
    if ((this.def as any).getDiscoveryPatterns) return (this.def as any).getDiscoveryPatterns();
    return getDiscoveryPatterns(this);
  }

  getSearchPatterns(filters: readonly QualifiedFilter[]): string[][] {
    if ((this.def as any).getSearchPatterns) return (this.def as any).getSearchPatterns(filters);
    return getSearchPatterns(filters, this);
  }

  getFormattableDefinitions(): Record<string, FormattableTrailerDefinition> {
    if ((this.def as any).getFormattableDefinitions) return (this.def as any).getFormattableDefinitions();
    return getFormattableDefinitions(this);
  }
}
