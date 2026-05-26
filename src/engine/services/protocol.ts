import type { Config, ValueDefinition, TrailerUiKind, TrailerUiColor } from '../types/config.js';
import type { ProtocolState, Atom, SupersessionStatus, StaleReason } from '../types/domain.js';
import type { FormattableTrailerDefinition } from '../types/output.js';
import type { IProtocol, AuthorizedTrailerDefinition } from '../interfaces/protocol.js';
import type { ProtocolDefinition } from '../interfaces/protocol-definition.js';

import { TrailerParser } from './trailer-parser.js';
import { escapeRegex } from '../../util/regex.js';
import { parseTriggerHints } from '../../util/trigger-parser.js';
import { STALE_SIGNAL } from '../../util/constants.js';

/**
 * A generic engine for Decision Protocols.
 * Drives validation, authorization, and Git discovery based on a provided ProtocolDefinition.
 * Merges built-in core trailers with project-specific custom configuration.
 *
 * SOLID: SRP -- focused purely on protocol rule orchestration.
 * SOLID: OCP -- open to new protocols via pluggable definitions.
 */
export class Protocol implements IProtocol {
  private readonly definitions = new Map<string, AuthorizedTrailerDefinition>();
  private readonly caseMap = new Map<string, string>();
  private readonly parser = new TrailerParser();

  constructor(
    private readonly definition: ProtocolDefinition,
    private readonly config: Config,
  ) {
    this.loadDefinitions();
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

  get permissive(): boolean {
    return this.config.trailers.permissive;
  }

  /**
   * Returns true if this protocol explicitly defines/owns the given trailer key.
   * Handles namespace-aware matching.
   */
  owns(key: string): boolean {
    const { namespace, baseKey } = this.splitKey(key);

    // 1. If key is namespaced, it only belongs to us if the namespace matches
    if (namespace) {
      return (
        namespace.toLowerCase() === this.namespace.toLowerCase() &&
        (this.caseMap.has(baseKey.toLowerCase()) || baseKey.toLowerCase() === this.identityKey.toLowerCase())
      );
    }

    // 2. If key is NOT namespaced, it only belongs to us if we are in the root namespace
    if (this.namespace !== '') {
      return false;
    }

    return (
      this.caseMap.has(baseKey.toLowerCase()) ||
      baseKey.toLowerCase() === this.identityKey.toLowerCase()
    );
  }

  /**
   * Returns the raw regex pattern that identifies a commit belonging to this protocol.
   * e.g., "^Lore-id: [0-9a-f]{8}"
   */
  getDiscoveryPattern(): string {
    const prefix = this.namespace ? `${this.namespace}/` : '';
    const identityDef = this.definition.trailers[this.identityKey];
    const pattern = identityDef?.pattern || '.+';

    return `^${prefix}${this.identityKey}: ${pattern.replace(/^\^|\$$/g, '')}`;
  }

  /**
   * Translates generic filters into specific Git grep arguments.
   */
  getSearchGrep(filters: Record<string, string | string[]>): string[] {
    const args: string[] = [];
    const prefix = this.namespace ? `${this.namespace}/` : '';

    for (const [key, value] of Object.entries(filters)) {
      const authorizedKey = this.authorize(key);
      if (!authorizedKey) continue;

      const values = Array.isArray(value) ? value : [value];
      for (const val of values) {
        args.push(`--grep=^${prefix}${authorizedKey}: ${val}`);
      }
    }

    return args;
  }

  /**
   * Application-level check: does this parsed state match the requested filters?
   */
  matches(state: ProtocolState, filters: Record<string, string | string[]>): boolean {
    // Only match against our own protocol data
    if (state.name.toLowerCase() !== this.name.toLowerCase()) {
      return true; // Don't block others
    }

    for (const [key, value] of Object.entries(filters)) {
      const authorizedKey = this.authorize(key);
      if (!authorizedKey) continue;

      const actualValues = state.trailers[authorizedKey] || [];
      const filterValues = Array.isArray(value) ? value : [value];

      if (actualValues.length === 0) {
        if (this.owns(key)) {
          return false;
        }
        continue;
      }

      const matched = filterValues.some((fv) =>
        actualValues.some((av) => av.toLowerCase() === fv.toLowerCase()),
      );

      if (!matched) return false;
    }

    return true;
  }

  /**
   * Parse raw trailers into a protocol-specific state.
   */
  parse(rawTrailers: string, claimedKeys?: Set<string>): ProtocolState {
    const rawMap = this.parser.parse(rawTrailers);
    const normalized: Record<string, string[]> = {};

    for (const [key, values] of Object.entries(rawMap)) {
      const { namespace, baseKey } = this.splitKey(key);
      const isOwner = this.owns(key);
      const isAlreadyClaimed = claimedKeys?.has(key) ?? false;

      // Ownership rules:
      // 1. Explicit owners always get the key.
      // 2. Permissive protocols get unclaimed keys in their namespace.
      // 3. We ignore keys that are explicitly owned by another protocol (namespaced differently).

      if (!isOwner) {
        if (!this.permissive) continue;
        if (isAlreadyClaimed) continue;
        if (namespace.toLowerCase() !== this.namespace.toLowerCase()) continue;
      }

      const authorizedKey = this.authorize(baseKey);
      if (!authorizedKey) continue;

      const def = this.getDefinition(authorizedKey);

      for (const value of values) {
        if (def?.validation === 'values' && def.values) {
          const validValues = Object.keys(def.values);
          if (!validValues.includes(value)) continue;
        }

        const existing = normalized[authorizedKey] ?? [];
        existing.push(value);
        normalized[authorizedKey] = existing;
      }
    }

    return {
      name: this.name,
      version: this.version,
      identityKey: this.identityKey,
      trailers: normalized,
    };
  }

  /**
   * Helper to split a trailer key into namespace and base key.
   */
  private splitKey(key: string): { namespace: string; baseKey: string } {
    const parts = key.split('/');
    if (parts.length > 1) {
      return { namespace: parts[0], baseKey: parts.slice(1).join('/') };
    }
    return { namespace: '', baseKey: key };
  }

  /**
   * Returns a Git grep pattern for finding a specific atom by its identity.
   */
  getIdentityPattern(id: string): string {
    const prefix = this.namespace ? `${this.namespace}/` : '';
    return `^${prefix}${this.identityKey}: ${escapeRegex(id)}`;
  }

  /**
   * Check if an ID is valid according to this protocol's rules.
   */
  isValidIdentity(id: string): boolean {
    const identityDef = this.definition.trailers[this.identityKey];
    if (identityDef?.validation === 'pattern' && identityDef.pattern) {
      return new RegExp(identityDef.pattern).test(id);
    }
    return id.length > 0;
  }

  /**
   * Extracts the identity value from a raw trailer dictionary.
   */
  getIdentity(trailers: Record<string, readonly string[]> | undefined | null): string | null {
    if (!trailers) return null;
    const values = trailers[this.identityKey];
    if (!values || values.length === 0) return null;
    return values[0];
  }

  /**
   * Check if a commit's raw trailers belong to this protocol.
   */
  claims(rawTrailers: string): boolean {
    const prefix = this.namespace ? `${this.namespace}/` : '';
    const pattern = new RegExp(`^${prefix}${this.identityKey}:`, 'i');
    return rawTrailers.split('\n').some((line) => pattern.test(line));
  }

  /**
   * Get Git grep arguments to find commits belonging to this protocol.
   */
  getDiscoveryGrep(): string[] {
    return [`--grep=${this.getDiscoveryPattern()}`];
  }

  private loadDefinitions(): void {
    // 1. Load Protocol-Defined Core Trailers
    for (const [key, def] of Object.entries(this.definition.trailers)) {
      this.addDefinition(key, { ...def, key, isCore: true });
    }

    // 2. Load Configured Custom Trailers (definitions)
    for (const [key, def] of Object.entries(this.config.trailers.definitions)) {
      const existing = this.definitions.get(key);
      const isCore = existing?.isCore ?? false;
      this.addDefinition(key, { ...def, key, isCore });
    }

    // 3. Load Simple Custom Trailers (from custom list)
    for (const key of this.config.trailers.custom) {
      if (!this.definitions.has(key)) {
        this.addDefinition(key, {
          key,
          description: `Custom project trailer: ${key}`,
          multivalue: true,
          validation: 'none',
          isCore: false,
        });
      }
    }

    // 4. Apply 'required' status from the required list (unification)
    for (const key of this.config.trailers.required) {
      const authorizedKey = this.authorize(key);
      if (authorizedKey) {
        const def = this.definitions.get(authorizedKey);
        if (def) {
          this.definitions.set(authorizedKey, { ...def, required: true });
        }
      }
    }
  }

  private addDefinition(key: string, def: AuthorizedTrailerDefinition): void {
    this.definitions.set(key, def);
    this.caseMap.set(key.toLowerCase(), key);
  }

  /**
   * Authorizes a trailer key for use.
   */
  authorize(key: string): string | null {
    const canonicalKey = this.caseMap.get(key.toLowerCase());
    if (canonicalKey) {
      return canonicalKey;
    }

    if (this.permissive) {
      return key;
    }

    return null;
  }

  /**
   * Returns the metadata definition for a key.
   */
  getDefinition(key: string): AuthorizedTrailerDefinition | null {
    const canonicalKey = this.caseMap.get(key.toLowerCase());
    return canonicalKey ? this.definitions.get(canonicalKey) || null : null;
  }

  /**
   * Returns all authorized keys (Core + Custom) sorted by prompt priority.
   */
  getAuthorizedKeys(): string[] {
    return Array.from(this.definitions.values())
      .sort((a, b) => (a.prompt?.order ?? 1000) - (b.prompt?.order ?? 1000))
      .map((d) => d.key);
  }

  /**
   * Returns all authorized keys for this protocol.
   */
  getAllKeys(): string[] {
    return Array.from(this.definitions.keys());
  }

  /**
   * Returns all keys that are defined as scalar (single-value).
   */
  getScalarKeys(): string[] {
    return Array.from(this.definitions.values())
      .filter((d) => !d.multivalue)
      .map((d) => d.key);
  }

  /**
   * Returns all keys that are defined as lists (multi-value).
   */
  getListKeys(): string[] {
    return Array.from(this.definitions.values())
      .filter((d) => d.multivalue)
      .map((d) => d.key);
  }

  /**
   * Returns all keys that reference other atoms.
   */
  getReferenceKeys(): string[] {
    return Array.from(this.definitions.values())
      .filter((d) => d.ui?.kind === 'reference')
      .map((d) => d.key);
  }

  /**
   * Returns true if the key belongs to the core protocol.
   */
  isCore(key: string): boolean {
    return this.getDefinition(key)?.isCore ?? false;
  }

  /**
   * Returns the semantic UI kind for a trailer.
   */
  getUiKind(key: string): TrailerUiKind {
    return this.getDefinition(key)?.ui?.kind || 'custom';
  }

  /**
   * Returns the semantic color for a trailer.
   */
  getUiColor(key: string): TrailerUiColor {
    return this.getDefinition(key)?.ui?.color || 'cyan';
  }

  getFormattableDefinitions(): Record<string, FormattableTrailerDefinition> {
    const result: Record<string, FormattableTrailerDefinition> = {};
    for (const [key, def] of this.definitions.entries()) {
      result[key] = {
        description: def.description,
        multivalue: def.multivalue,
        validation: def.validation,
        values: this.normalizeValues(def.values),
        pattern: def.pattern,
        required: def.required,
        isCore: def.isCore,
        directives: def.directives ?? [],
        ui: def.ui,
      };
    }
    return result;
  }

  /**
   * Returns a list of staleness signals identified for an atom.
   */
  getStaleSignals(
    atom: Atom,
    now: Date,
    supersessionMap: Map<string, SupersessionStatus>,
  ): StaleReason[] {
    const reasons: StaleReason[] = [];
    const state = atom.protocols.get(this.name.toLowerCase());
    if (!state) return reasons;

    // 1. Low Confidence Signal
    const confidence = state.trailers.Confidence?.[0];
    if (confidence === 'low') {
      reasons.push({
        signal: STALE_SIGNAL.LOW_CONFIDENCE,
        description: `[${this.name}] Atom is marked as Confidence: low`,
      });
    }

    // 2. Expired Hints Signal
    for (const directive of state.trailers.Directive || []) {
      const hints = parseTriggerHints(directive);
      if (hints.until && now > hints.until) {
        reasons.push({
          signal: STALE_SIGNAL.EXPIRED_HINT,
          description: `[${this.name}] Directive "${directive}" has expired`,
        });
      }
    }

    // 3. Orphaned Dependency Signal
    const refKeys = this.getReferenceKeys();
    for (const key of refKeys) {
      const ids = state.trailers[key] || [];
      for (const id of ids) {
        const status = supersessionMap.get(id);
        if (status?.superseded) {
          reasons.push({
            signal: STALE_SIGNAL.ORPHANED_DEP,
            description: `[${this.name}] Dependency "${id}" (in ${key}) has been superseded by ${status.supersededBy}`,
          });
        }
      }
    }

    return reasons;
  }

  private normalizeValues(
    values?: Record<string, string | ValueDefinition>,
  ): Record<string, ValueDefinition> | undefined {
    if (!values) return undefined;

    const result: Record<string, ValueDefinition> = {};
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === 'string') {
        result[key] = { description: value };
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
