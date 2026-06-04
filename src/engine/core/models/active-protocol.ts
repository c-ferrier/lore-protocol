import { ProtocolMap, type ProtocolName } from './protocol-map.js';
import { ProtocolHydrator } from '../../shell/fs/protocol-hydrator.js';
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
    Trailers
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
  public readonly context: ProtocolContext;

  private readonly definitions = new Map<string, TrailerDefinition & { key: string }>();

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
    this.context = this;

    this.loadDefinitions();
  }

  /**
   * Translates a raw key into its canonical, schema-defined case.
   */
  authorize(key: string): string | null {
    return authorizeKey(key, this.context);
  }

  /**
   * Returns all trailer keys explicitly defined in the protocol schema.
   */
  getAuthorizedKeys(): string[] {
    return getAuthorizedKeys(this.context);
  }

  getScalarKeys(): string[] {
    return getScalarKeys(this.context);
  }

  getListKeys(): string[] {
    return getListKeys(this.context);
  }

  getDefinition(key: string): TrailerDefinition | null {
    return this.definitions.get(key) || null;
  }

  getReferenceKeys(): string[] {
    return getReferenceKeys(this.context);
  }

  getStoragePrefix(): string {
    return this.storagePrefix;
  }

  getQualifiedKey(key: string): string {
    return getQualifiedKey(key, this.context);
  }

  isBucketOwner(key: string): boolean {
    return isBucketOwner(key, this.context);
  }

  owns(key: string): boolean {
    return ownsKey(key, this.context);
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
    return normalizeTrailers(rawMap, this.context, claimedKeys);
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
    return isCoreTrailer(key, this.context);
  }

  matches(state: ProtocolState, filters: readonly QualifiedFilter[]): boolean {
    return matchesFilters(state, filters, this.context);
  }

  claims(raw: string): boolean {
    return claimsTrailers(raw, this.context);
  }

  getDiscoveryPatterns(): string[] {
    return getDiscoveryPatterns(this.context);
  }

  getSearchPatterns(filters: readonly QualifiedFilter[]): string[][] {
    return getSearchPatterns(filters, this.context);
  }

  getFormattableDefinitions(): Record<string, FormattableTrailerDefinition> {
    return getFormattableDefinitions(this.context);
  }

  getStaleSignals(
    atom: Atom,
    now: Date,
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>,
  ): StaleReason[] {
    return getProtocolStaleSignals(this.context, atom, now, globalSupersessionMap);
  }

  private loadDefinitions(): void {
    for (const [key, tDef] of Object.entries(this.def.trailers || {} || {})) {
      const hydrated = ProtocolHydrator.hydrateTrailer(key, tDef);
      // Ensure isCore defaults to false if not specified
      const isCore = hydrated.isCore ?? false;
      this.definitions.set(key, { ...hydrated, key, isCore });
    }
  }
}
