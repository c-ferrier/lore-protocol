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
    StaleIfCondition 
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
import type { QualifiedFilter, FilterOperator } from '../types/query.js';
import { STALE_SIGNAL } from '../../util/constants.js';
import { TriggerParser, parseTriggerHints } from '../../util/trigger-parser.js';
import { ProtocolQueryAdapter } from '../../shell/git/protocol-query-adapter.js';

import { 
    validateProtocolState, 
    validateProtocolTrailer, 
    isValidProtocolIdentity 
} from '../logic/validation.js';

import { createProtocolContext } from '../logic/protocols.js';
import { getQualifiedKey, isBucketOwner, ownsKey, authorizeKey } from '../logic/ownership.js';
import { normalizeTrailers } from '../logic/normalization.js';

export type ActiveTrailer = TrailerDefinition & { key: string };

/**
 * Functional model of a Protocol in the Atom Engine.
 * 
 * Responsibility: Drive all schema math, normalization, and sovereignty
 * using the project's Waterfall Logic.
 */
export class ActiveProtocol implements IProtocol {
  public readonly name: string;
  public readonly version: string;
  public readonly strict: boolean;
  public readonly permissive: boolean;
  public readonly identityKey: string;
  public readonly storageNamespace: string;

  private readonly definitions = new Map<string, TrailerDefinition & { key: string }>();
  private readonly context: ProtocolContext;

  constructor(
    private readonly definition: ProtocolDefinition
  ) {
    this.name = definition.name.toLowerCase();
    this.version = definition.version;
    this.strict = definition.strict ?? true;
    this.permissive = definition.permissive ?? false;
    this.identityKey = definition.identityKey;
    this.storageNamespace = definition.namespace || '';
    
    this.context = createProtocolContext(definition);
    this.loadDefinitions();
  }

  /**
   * Translates a raw key into its canonical, schema-defined case.
   * If the key is not in the schema:
   * - Root + Permissive: Returns the key as-is (allowed guest).
   * - Otherwise: Returns null (unauthorized).
   */
  authorize(key: string): string | null {
    return authorizeKey(key, this.context);
  }

  /**
   * Returns all trailer keys explicitly defined in the protocol schema.
   * Result is sorted numerically by 'prompt.order' (ascending).
   * Note: This does NOT include dynamic keys accepted via permissive mode.
   */
  getAuthorizedKeys(): string[] {
    return Array.from(this.definitions.keys()).sort((a, b) => {
      const orderA = this.definitions.get(a)?.prompt?.order ?? 1000;
      const orderB = this.definitions.get(b)?.prompt?.order ?? 1000;
      return orderA - orderB; // Standard numeric ascending sort
    });
  }

  /**
   * Returns all schema-defined keys that allow only a single value.
   */
  getScalarKeys(): string[] {
    return this.getAuthorizedKeys().filter(k => !this.getDefinition(k)?.multivalue);
  }

  /**
   * Returns all schema-defined keys that allow multiple values.
   */
  getListKeys(): string[] {
    return this.getAuthorizedKeys().filter(k => this.getDefinition(k)?.multivalue);
  }

  /**
   * Retrieves the full definition for a specific trailer key.
   */
  getDefinition(key: string): TrailerDefinition | null {
    return this.definitions.get(key) || null;
  }

  /**
   * Returns all schema-defined keys that serve as references to other atoms.
   */
  getReferenceKeys(): string[] {
    return this.getAuthorizedKeys().filter(k => this.getDefinition(k)?.validation === 'reference');
  }

  /**
   * Returns the prefix used when persisting trailers to Git.
   * Namespaced: "Namespace: " (e.g. "Jira: ")
   * Root: "" (e.g. "Confidence: ")
   */
  getStoragePrefix(): string {
    return this.context.storagePrefix;
  }

  /**
   * Returns a fully qualified key for UI or error reporting.
   * Namespaced: "Namespace:Key"
   * Root: "Key"
   */
  getQualifiedKey(key: string): string {
    return getQualifiedKey(key, this.context);
  }

  /**
   * Checks if a top-level key matches the protocol's persistence bucket.
   * E.g. for Jira protocol, matches "Jira".
   */
  isBucketOwner(key: string): boolean {
    return isBucketOwner(key, this.context);
  }

  /**
   * Defines definitively what this protocol "owns" at the TOP LEVEL of the git log.
   * STRICT SEGMENTATION: 
   * - Namespaced protocols ONLY own their literal namespace key.
   * - Root protocols own their identityKey and everything in their schema.
   */
  owns(key: string): boolean {
    return ownsKey(key, this.context);
  }

  /**
   * Returns true if this protocol operates in the global (root) namespace.
   */
  isRoot(): boolean {
    return this.context.isRoot;
  }

  /**
   * Validates if a string matches the protocol's identity format.
   */
  isValidIdentity(id: string): boolean {
    return isValidProtocolIdentity(id, this.definition);
  }

  /**
   * Convenience wrapper to parse a raw string and normalize it into ProtocolState.
   */
  parse(raw: string, claimedKeys?: Set<string>): ProtocolState {
    const rawMap = TriggerParser.parseTrailers(raw);
    return this.normalize(rawMap, claimedKeys);
  }

  /**
   * Normalizes a raw key-value map into structured ProtocolState using the 
   * Strict Segmented Waterfall.
   * 
   * @param rawMap Map of top-level keys to arrays of values.
   * @param claimedKeys Set of keys (namespaces or core trailers) reserved by OTHER protocols.
   */
  normalize(rawMap: Record<string, readonly string[]>, claimedKeys?: Set<string>): ProtocolState {
    return normalizeTrailers(rawMap, this.context, claimedKeys);
  }

  getIdentity(state?: ProtocolState | null): string | null {
    if (!state) return null;
    const values = state.trailers[this.identityKey];
    if (!values || values.length === 0) return null;
    return values[0];
  }

  /**
   * Validates a protocol state against its definition.
   */
  validateState(state: ProtocolState, resolver?: IIdentityResolver): ValidationIssue[] {
    return validateProtocolState(state, this.definition, resolver);
  }

  /**
   * Validates a single trailer value.
   */
  validateTrailer(key: string, value: string, resolver?: IIdentityResolver): { valid: boolean; message?: string; rule?: string } {
    return validateProtocolTrailer(key, value, this.definition, resolver);
  }

  isCore(key: string): boolean {
    const def = this.getDefinition(key);
    return def?.isCore ?? false;
  }

  matches(state: ProtocolState, filters: readonly QualifiedFilter[]): boolean {
    return new ProtocolQueryAdapter(this as any).matches(state, filters);
  }

  claims(raw: string): boolean {
    return new ProtocolQueryAdapter(this as any).claims(raw);
  }

  getDiscoveryPatterns(): string[] {
    return new ProtocolQueryAdapter(this as any).getDiscoveryPatterns();
  }

  getSearchPatterns(filters: readonly QualifiedFilter[]): string[][] {
    return new ProtocolQueryAdapter(this as any).getSearchPatterns(filters);
  }

  getFormattableDefinitions(): Record<string, FormattableTrailerDefinition> {
    const results: Record<string, FormattableTrailerDefinition> = {};
    const keys = this.getAuthorizedKeys();

    for (const key of keys) {
        const def = this.getDefinition(key);
        if (!def) continue;

        results[key] = {
            ...def,
            ui: {
                kind: (def.ui?.kind || 'text') as any,
                color: def.ui?.color || 'dim',
            }
        } as any;
    }

    return results;
  }

  /**
   * Evaluates staleness signals using DYNAMIC declarative triggers.
   */
  getStaleSignals(
    atom: Atom,
    now: Date,
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>,
  ): StaleReason[] {
    const reasons: StaleReason[] = [];
    const pName = this.name.toLowerCase();
    const state = atom.protocols.get(pName) || atom.protocols.get(this.name);
    if (!state) return reasons;

    for (const key of this.getAuthorizedKeys()) {
      const def = this.getDefinition(key);
      if (!def?.stale_if) continue;

      const conditions = Array.isArray(def.stale_if) ? def.stale_if : [def.stale_if];
      
      // Search with case-insensitivity against state.trailers
      const actualKey = Object.keys(state.trailers).find(k => k.toLowerCase() === key.toLowerCase()) || key;
      const values = state.trailers[actualKey] || [];

      for (const value of values) {
        for (const condition of conditions) {
            const reason = this.evaluateStaleCondition(condition, state, key, value, now, globalSupersessionMap);
            if (reason) reasons.push(reason);
        }
      }
    }
    return reasons;
  }

  private evaluateStaleCondition(
    condition: StaleIfCondition,
    state: ProtocolState,
    key: string,
    value: string,
    now: Date,
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>
  ): StaleReason | null {
    switch (condition.kind) {
      case 'value-equals': {
        if (TriggerParser.strip(value) === condition.value) {
          return {
            signal: condition.signal || STALE_SIGNAL.VALUE_MATCH,
            description: `[${this.name}] Atom is marked as ${key}: ${condition.value}`
          };
        }
        break;
      }
      case 'date-expired': {
        const hints = parseTriggerHints(value);
        if (hints.until && now > hints.until) {
          return {
            signal: condition.signal || STALE_SIGNAL.EXPIRED_HINT,
            description: `[${this.name}] ${key} "${value}" has expired`
          };
        }
        break;
      }
      case 'reference-superseded': {
        try {
          const currentId = this.getIdentity(state);
          let targetId = value;
          let targetPName = this.name;
          if (value.includes('/')) {
            const [prefix, suffix] = value.split('/', 2);
            targetPName = prefix.toLowerCase();
            targetId = suffix;
          }
          const isLocal = targetPName === this.name;
          const targetStatusMap = globalSupersessionMap.get(targetPName);
          const status = targetStatusMap?.get(targetId);

          if (status?.superseded) {
            const supersededByList = Array.isArray(status.supersededBy) ? status.supersededBy : [status.supersededBy];
            
            // Check if superseded by someone ELSE
            const isBySomeoneElse = !isLocal || 
                (!supersededByList.includes(currentId || '') && 
                 !supersededByList.includes(`${targetPName}/${currentId}`));

            if (isBySomeoneElse) {
                return {
                    signal: condition.signal || STALE_SIGNAL.ORPHANED_DEP,
                    description: `[${this.name}] Dependency "${value}" (in ${key}) has been superseded by ${status.supersededBy.join(', ')}`,
                };
            }
          }
        } catch { /* ignore */ }
        break;
      }
    }
    return null;
  }

  private loadDefinitions(): void {
    for (const [key, def] of Object.entries(this.definition.trailers || {} || {})) {
      const hydrated = ProtocolHydrator.hydrateTrailer(key, def);
      // Ensure isCore defaults to false if not specified
      const isCore = hydrated.isCore ?? false;
      this.definitions.set(key, { ...hydrated, key, isCore });
    }
  }
}
