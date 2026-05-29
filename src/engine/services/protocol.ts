import type { ProtocolConfig, ValueDefinition, TrailerUiKind, TrailerUiColor, TrailerDefinition } from '../types/config.js';
import type { ProtocolState, Atom, SupersessionStatus, StaleReason } from '../types/domain.js';
import type { FormattableTrailerDefinition } from '../types/output.js';
import { type IProtocol, type ActiveTrailer } from '../interfaces/protocol.js';
import type { ProtocolDefinition } from '../interfaces/protocol-definition.js';
import type { ProtocolRegistry } from './protocol-registry.js';

import { TrailerParser } from './trailer-parser.js';
import { ProtocolHydrator } from './protocol-hydrator.js';
import { escapeRegex } from '../util/regex.js';

/**
 * A generic engine for Decision Protocols.
 * Drives validation, authorization, and Git discovery based on a provided ProtocolDefinition.
 * Merges built-in core trailers with project-specific custom configuration.
 *
 * SOLID: SRP -- focused purely on protocol rule orchestration.
 * SOLID: OCP -- open to new protocols via pluggable definitions.
 */
export class Protocol implements IProtocol {
  private readonly definitions = new Map<string, ActiveTrailer>();
  private readonly caseMap = new Map<string, string>();
  private readonly parser = new TrailerParser();
  private registry?: ProtocolRegistry;

  constructor(
    private readonly definition: ProtocolDefinition,
    private readonly config: ProtocolConfig,
  ) {
    this.loadDefinitions();
  }

  setRegistry(registry: ProtocolRegistry): void {
    this.registry = registry;
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
   */
  owns(key: string): boolean {
    const lowerKey = key.toLowerCase();

    // 1. If we are namespaced, we own exactly one Git Key: our namespace name
    if (this.namespace !== '') {
      return lowerKey === this.namespace.toLowerCase();
    }

    // 2. If we are root, we own the keys defined in our schema
    return (
      this.caseMap.has(lowerKey) ||
      lowerKey === this.identityKey.toLowerCase()
    );
  }

  /**
   * Returns the raw regex pattern that identifies a commit belonging to this protocol.
   * Uses Namespace: Key: value for namespaced protocols.
   */
  getDiscoveryPattern(): string {
    if (this.namespace !== '') {
      // Coarse pass: just find the namespace key at start of line
      return `^${this.namespace}:`;
    }

    const identityDef = this.definition.trailers[this.identityKey];
    const pattern = identityDef?.pattern || '.+';
    return `^${this.identityKey}: ${pattern.replace(/^\^|\$$/g, '')}`;
  }

  /**
   * Translates generic filters into specific Git grep arguments.
   */
  getSearchGrep(filters: Record<string, string | string[]>): string[] {
    const args: string[] = [];

    for (const [key, value] of Object.entries(filters)) {
      const authorizedKey = this.authorize(key);
      if (!authorizedKey) continue;

      const values = Array.isArray(value) ? value : [value];
      for (const val of values) {
        if (this.namespace !== '') {
            // Namespaced search: --grep="^Namespace: Key: value"
            args.push(`--grep=^${this.namespace}: ${authorizedKey}: ${val}`);
        } else {
            // Root search: --grep="^Key: value"
            args.push(`--grep=^${authorizedKey}: ${val}`);
        }
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
        // If we own the key but it has no values in the state, it's a mismatch
        if (this.owns(key) || this.authorize(key)) {
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
   * Enforces strict hierarchical ownership and permissive rules.
   */
  parse(rawTrailers: string, claimedKeys?: Set<string>, includeInvalid = false): ProtocolState {
    const rawMap = this.parser.parse(rawTrailers);
    const normalized: Record<string, string[]> = {};
    const unauthorized: Record<string, string[]> = {};
    const lowerClaimed = new Set(Array.from(claimedKeys || []).map(k => k.toLowerCase()));

    for (const [key, values] of Object.entries(rawMap)) {
      const lowerKey = key.toLowerCase();
      const isOwner = this.owns(key);
      const isReserved = lowerClaimed.has(lowerKey);

      // Logic for Namespaced Protocol
      if (this.namespace !== '') {
        if (!isOwner) continue;

        // Unpack nested values: "Key: value"
        for (const nestedRaw of values) {
          const match = nestedRaw.match(/^([A-Za-z0-9][A-Za-z0-9-]*):\s*(.*)$/);
          if (!match) {
            // Not a recognized inner trailer format - goes to unauthorized
            const existing = unauthorized['invalid-format'] || [];
            unauthorized['invalid-format'] = [...existing, nestedRaw];
            continue;
          }

          const innerKey = match[1];
          const innerValue = match[2];
          const authorizedKey = this.authorize(innerKey);

          if (authorizedKey) {
            const def = this.getDefinition(authorizedKey);
            let isValueAuthorized = true;

            if (def?.validation === 'values' && def.values) {
                isValueAuthorized = Object.keys(def.values).includes(innerValue);
            } else if (def?.validation === 'pattern' && def.pattern) {
                isValueAuthorized = new RegExp(def.pattern).test(innerValue);
            }

            if (isValueAuthorized || includeInvalid) {
                const existing = normalized[authorizedKey] ?? [];
                existing.push(innerValue);
                normalized[authorizedKey] = existing;
            }
          } else {
            // Intended for us (namespaced) but not in schema
            const existing = unauthorized[innerKey] || [];
            unauthorized[innerKey] = [...existing, innerValue];
          }
        }
        continue;
      }

      // Logic for Root Namespace Protocol
      if (isOwner) {
        // Authorize the primary key
        const authorizedKey = this.authorize(key);
        if (authorizedKey) {
          const def = this.getDefinition(authorizedKey);
          const authorizedValues: string[] = [];

          for (const v of values) {
              let isValueAuthorized = true;
              if (def?.validation === 'values' && def.values) {
                  isValueAuthorized = Object.keys(def.values).includes(v);
              } else if (def?.validation === 'pattern' && def.pattern) {
                  isValueAuthorized = new RegExp(def.pattern).test(v);
              }

              if (isValueAuthorized || includeInvalid) {
                  authorizedValues.push(v);
              }
          }

          if (authorizedValues.length > 0) {
              const existing = normalized[authorizedKey] ?? [];
              existing.push(...authorizedValues);
              normalized[authorizedKey] = existing;
          }
        }
        continue;
      }

      // Handle orphans (not claimed by any namespace or root schema)
      if (!isReserved) {
        if (this.permissive) {
          // Accept orphan directly
          const existing = normalized[key] ?? [];
          existing.push(...values);
          normalized[key] = existing;
        } else {
          // Flag orphan as unauthorized
          const existing = unauthorized[key] || [];
          unauthorized[key] = [...existing, ...values];
        }
      }
    }

    return {
      name: this.name,
      version: this.version,
      identityKey: this.identityKey,
      trailers: normalized,
      unauthorized,
    };
  }

  /**
   * Returns a Git grep pattern for finding a specific atom by its identity.
   */
  getIdentityPattern(id: string): string {
    if (this.namespace !== '') {
        return `^${this.namespace}: ${this.identityKey}: ${escapeRegex(id)}`;
    }
    return `^${this.identityKey}: ${escapeRegex(id)}`;
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
    const pattern = this.namespace !== ''
        ? new RegExp(`^${this.namespace}:`, 'i')
        : new RegExp(`^${this.identityKey}:`, 'i');
    
    return rawTrailers.split('\n').some((line) => pattern.test(line));
  }

  /**
   * Get Git grep arguments to find commits belonging to this protocol.
   */
  getDiscoveryGrep(): string[] {
    return [`--grep=${this.getDiscoveryPattern()}`];
  }

  private loadDefinitions(): void {
    // 1. Load Protocol-Defined Trailers (from static definition)
    for (const [key, def] of Object.entries(this.definition.trailers)) {
      this.addDefinition(key, { 
        ...ProtocolHydrator.hydrateTrailer(key, def), 
        key 
      });
    }

    // 2. Load Configured Custom Trailers & Overrides (from TOML config)
    for (const [key, def] of Object.entries(this.config.trailers.definitions)) {
      const canonicalKey = this.authorize(key) || key;
      const existing = this.definitions.get(canonicalKey);
      
      const hydrated = ProtocolHydrator.hydrateTrailer(canonicalKey, def);
      
      // Strategy: Merge config onto base. 
      // isCore logic: 
      // - If config explicitly sets isCore, use it.
      // - Else, if we are overriding a core trailer, it stays core.
      // - Else, default to false (handled by hydrator).
      const isCore = (def.isCore !== undefined) ? hydrated.isCore : (existing?.isCore ?? false);

      this.addDefinition(canonicalKey, {
          ...existing,
          ...hydrated,
          key: canonicalKey,
          isCore
      });
    }
  }

  private addDefinition(key: string, def: ActiveTrailer): void {
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
  getDefinition(key: string): ActiveTrailer | null {
    const canonicalKey = this.caseMap.get(key.toLowerCase());
    return canonicalKey ? this.definitions.get(canonicalKey) || null : null;
  }

  /**
   * Validates a single trailer value against the protocol schema.
   * Handles enums, regex patterns, and cross-protocol reference format checks.
   */
  validateTrailer(key: string, value: string): { valid: boolean; message?: string; rule?: string } {
    const def = this.getDefinition(key);
    if (!def) {
      // If not defined and protocol is permissive, it's valid as a generic string
      return { valid: true };
    }

    // 1. Enum Validation
    if (def.validation === 'values' && def.values) {
      const allowed = Object.keys(def.values);
      if (!allowed.includes(value)) {
        return {
          valid: false,
          rule: 'invalid-enum',
          message: `[${this.name}] Invalid value for "${key}": "${value}". Expected one of: ${allowed.join(', ')}`,
        };
      }
    }

    // 2. Pattern Validation
    if (def.validation === 'pattern' && def.pattern) {
      const regex = new RegExp(def.pattern);
      if (!regex.test(value)) {
        let rule = 'invalid-format';
        let message = `[${this.name}] Value for "${key}" does not match pattern: ${def.pattern}`;
        
        // Identity special case
        if (key === this.identityKey) {
            rule = `${this.name.toLowerCase().replace(/-/g, '')}-id-format`;
            message = `[${this.name}] ${this.identityKey} "${value}" is not a valid identifier`;
        }

        return { valid: false, rule, message };
      }
    }

    // 3. Reference Validation (The "Mask" Check)
    if (def.validation === 'reference') {
      let targetPName = this.name.toLowerCase();
      let targetId = value;

      if (value.includes('/')) {
        const [prefix, suffix] = value.split('/', 2);
        targetPName = prefix.toLowerCase();
        targetId = suffix;
      }

      const isLocal = targetPName === this.name.toLowerCase();

      // 1. Boundary Enforcement (crossProtocol: false)
      if (def.crossProtocol === false && !isLocal) {
        return {
          valid: false,
          rule: 'cross-protocol-prohibited',
          message: `[${this.name}] Trailer "${key}" does not allow cross-protocol references (got "${targetPName}")`,
        };
      }

      // 2. Format Validation (Local)
      // If it's local (either no prefix or matches our own name), we validate it internally
      if (isLocal) {
        if (!this.isValidIdentity(targetId)) {
          return {
            valid: false,
            rule: 'reference-format',
            message: `[${this.name}] Invalid reference format in ${key}: "${value}".`,
          };
        }
        return { valid: true };
      }

      // 3. Format Validation (Cross-Protocol)
      // If we got here, it's NOT local. We require a registry to verify the neighbor.
      if (!this.registry) {
        return {
          valid: false,
          rule: 'unknown-protocol-prefix',
          message: `[${this.name}] Unknown protocol prefix: "${targetPName}" (Registry not linked)`,
        };
      }

      try {
        const identity = this.registry.resolveIdentity(value, this.name.toLowerCase());
        const targetProtocol = this.registry.get(identity.protocol || targetPName);
        
        if (targetProtocol && !targetProtocol.isValidIdentity(identity.id)) {
            return {
                valid: false,
                rule: 'invalid-reference-format',
                message: `[${this.name}] Reference "${value}" is not a valid identifier for protocol "${targetProtocol.name}"`,
            };
        }
      } catch (err) {
        return {
            valid: false,
            rule: 'unknown-protocol-prefix',
            message: `[${this.name}] ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    return { valid: true };
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
      .filter((d) => d.validation === 'reference' || d.ui?.kind === 'reference')
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
        isCore: !!def.isCore,
        crossProtocol: def.crossProtocol,
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
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>,
  ): StaleReason[] {
    if (this.definition.getStaleSignals) {
      return this.definition.getStaleSignals(atom, now, globalSupersessionMap);
    }
    return [];
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
