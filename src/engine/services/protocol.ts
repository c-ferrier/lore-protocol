import type { ProtocolConfig, ValueDefinition, TrailerUiKind, TrailerUiColor } from '../types/config.js';
import type { ProtocolState, Atom, SupersessionStatus, StaleReason, Trailers } from '../types/domain.js';
import type { FormattableTrailerDefinition, ValidationIssue } from '../types/output.js';
import { type IProtocol, type ActiveTrailer } from '../interfaces/protocol.js';
import type { ProtocolDefinition } from '../interfaces/protocol-definition.js';
import type { ProtocolRegistry } from './protocol-registry.js';

import { TrailerParser } from './trailer-parser.js';
import { ProtocolHydrator } from './protocol-hydrator.js';

import { ProtocolSchema } from './protocol/protocol-schema.js';
import { ProtocolInterpreter } from './protocol/protocol-interpreter.js';
import { ProtocolValidator } from './protocol/protocol-validator.js';
import { ProtocolQueryAdapter } from './protocol/protocol-query-adapter.js';

/**
 * A generic engine for Decision Protocols.
 * Drives validation, authorization, and Git discovery based on a provided ProtocolDefinition.
 * 
 * DESIGN: This is a Facade that delegates to specialized capability modules.
 * SOLID: SRP -- decomposed into Schema, Interpreter, Validator, and QueryAdapter.
 * SOLID: OCP -- open to new protocols via pluggable definitions.
 */
export class Protocol implements IProtocol {
  private readonly definitions = new Map<string, ActiveTrailer>();
  private readonly caseMap = new Map<string, string>();
  private readonly parser = new TrailerParser();
  private registry?: ProtocolRegistry;

  // Delegates
  private readonly schema: ProtocolSchema;
  private readonly interpreter: ProtocolInterpreter;
  private readonly validator: ProtocolValidator;
  private readonly queryAdapter: ProtocolQueryAdapter;

  constructor(private readonly definition: ProtocolDefinition) {
    this.loadDefinitions();

    // Instantiate Delegates (Composition)
    this.schema = new ProtocolSchema(this.definitions, this.caseMap, this.permissive);
    this.interpreter = new ProtocolInterpreter(this, this.parser);
    this.validator = new ProtocolValidator(this);
    this.queryAdapter = new ProtocolQueryAdapter(this);
  }

  setRegistry(registry: ProtocolRegistry): void {
    this.registry = registry;
    this.validator.setRegistry(registry);
  }

  get name(): string {
    return this.definition.name;
  }

  get version(): string {
    return this.definition.version;
  }

  get identityKey(): string {
    return this.definition.identityKey;
  }

  get namespace(): string {
    return this.definition.namespace;
  }

  get strict(): boolean {
    return this.definition.strict;
  }

  get permissive(): boolean {
    return this.definition.permissive;
  }

  // --- IProtocolSchema Delegation ---

  owns(key: string): boolean {
    const lowerKey = key.toLowerCase();
    // Namespacing check remains in the Facade as it's a high-level ownership rule
    if (this.namespace !== '') {
      return lowerKey === this.namespace.toLowerCase();
    }
    return this.schema.owns(key) || lowerKey === this.identityKey.toLowerCase();
  }

  isCore(key: string): boolean {
    return this.schema.isCore(key);
  }

  authorize(key: string): string | null {
    return this.schema.authorize(key);
  }

  getDefinition(key: string): ActiveTrailer | null {
    return this.schema.getDefinition(key);
  }

  getAuthorizedKeys(): string[] {
    return this.schema.getAuthorizedKeys();
  }

  getAllKeys(): string[] {
    return this.schema.getAllKeys();
  }

  getScalarKeys(): string[] {
    return this.schema.getScalarKeys();
  }

  getListKeys(): string[] {
    return this.schema.getListKeys();
  }

  getReferenceKeys(): string[] {
    return this.schema.getReferenceKeys();
  }

  getUiKind(key: string): TrailerUiKind {
    return this.schema.getUiKind(key);
  }

  getUiColor(key: string): TrailerUiColor {
    return this.schema.getUiColor(key);
  }

  getFormattableDefinitions(): Record<string, FormattableTrailerDefinition> {
    return this.schema.getFormattableDefinitions();
  }

  // --- IProtocolInterpreter Delegation ---

  parse(rawTrailers: string, claimedKeys?: Set<string>): ProtocolState {
    return this.interpreter.parse(rawTrailers, claimedKeys);
  }

  normalize(rawMap: Trailers, claimedKeys?: Set<string>): ProtocolState {
    return this.interpreter.normalize(rawMap, claimedKeys);
  }

  getIdentity(state?: ProtocolState | null): string | null {
    return this.interpreter.getIdentity(state);
  }

  isValidIdentity(id: string): boolean {
    return this.interpreter.isValidIdentity(id);
  }

  getStaleSignals(
    atom: Atom,
    now: Date,
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>,
  ): StaleReason[] {
    if (this.definition.getStaleSignals) {
      return this.definition.getStaleSignals(atom, now, globalSupersessionMap);
    }
    return this.interpreter.getStaleSignals(atom, now, globalSupersessionMap);
  }

  // --- IProtocolValidator Delegation ---

  validateState(state: ProtocolState, options?: { strict?: boolean }): ValidationIssue[] {
    return this.validator.validateState(state, options);
  }

  validateTrailer(key: string, value: string): { valid: boolean; message?: string; rule?: string } {
    return this.validator.validateTrailer(key, value);
  }

  // --- IProtocolQueryAdapter Delegation ---

  getDiscoveryPattern(): string {
    return this.queryAdapter.getDiscoveryPattern();
  }

  getDiscoveryGrep(): string[] {
    return this.queryAdapter.getDiscoveryGrep();
  }

  getSearchGrep(filters: Record<string, string | string[]>): string[] {
    return this.queryAdapter.getSearchGrep(filters);
  }

  getIdentityPattern(id: string): string {
    return this.queryAdapter.getIdentityPattern(id);
  }

  matches(state: ProtocolState, filters: Record<string, string | string[]>): boolean {
    return this.queryAdapter.matches(state, filters);
  }

  claims(rawTrailers: string): boolean {
    return this.queryAdapter.claims(rawTrailers);
  }

  private loadDefinitions(): void {
    // Populate and sanitize maps from the static definition
    for (const [key, def] of Object.entries(this.definition.trailers)) {
      const hydrated = ProtocolHydrator.hydrateTrailer(key, def);
      this.addDefinition(key, { 
        ...hydrated, 
        key 
      });
    }
  }

  private addDefinition(key: string, def: ActiveTrailer): void {
    this.definitions.set(key, def);
    this.caseMap.set(key.toLowerCase(), key);
  }
}
