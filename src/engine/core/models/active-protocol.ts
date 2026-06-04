import { ProtocolMap, type ProtocolName } from './protocol-map.js';
import type { 
    ProtocolDefinition, 
    ProtocolContext,
    IIdentityResolver, 
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

import { getProtocolIdentity } from '../logic/identity.js';
import { getProtocolStaleSignals } from '../logic/staleness.js';

export type ActiveTrailer = TrailerDefinition & { key: string };

/**
 * Functional model of a Protocol in the Atom Engine.
 * 
 * Responsibility: Provide a backward-compatible class interface that 
 * delegates all 'Judgment Brain' logic to stateless pure functions.
 * 
 * Satisfies ProtocolContext to allow seamless transition.
 */
export class ActiveProtocol implements ProtocolContext {
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
   * Helper to satisfy legacy code that still expects a .context property.
   */
  public get context(): ProtocolContext {
      return this;
  }

  isValidIdentity(id: string): boolean {
    if ((this.def as any).isValidIdentity) return (this.def as any).isValidIdentity(id);
    return isValidProtocolIdentity(id, this.def);
  }

  parse(raw: string, claimedKeys?: Set<string>): ProtocolState {
    const rawMap = TriggerParser.parseTrailers(raw);
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

  getFormattableDefinitions(): Record<string, FormattableTrailerDefinition> {
    if ((this.def as any).getFormattableDefinitions) return (this.def as any).getFormattableDefinitions();
    return getFormattableDefinitions(this);
  }
}
