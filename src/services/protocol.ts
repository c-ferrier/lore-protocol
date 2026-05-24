import type { LoreConfig, ValueDefinition, TrailerUiKind, TrailerUiColor } from '../types/config.js';
import { CORE_TRAILER_DEFINITIONS, LORE_ID_PATTERN } from '../util/constants.js';
import type { TrailerKey, ProtocolState } from '../types/domain.js';
import type { FormattableTrailerDefinition } from '../types/output.js';
import type { IProtocol, AuthorizedTrailerDefinition } from '../interfaces/protocol.js';

import { TrailerParser } from './trailer-parser.js';

/** The canonical identity key for the Lore Protocol */
const LORE_IDENTITY_KEY = 'Lore-id';

/**
 * The central engine for Lore Protocol rules.
 * Merges built-in core trailers with project-specific custom configuration.
 * Provides lookup and authorization services for builders and formatters.
 */
export class Protocol implements IProtocol {
  private readonly definitions = new Map<string, AuthorizedTrailerDefinition>();
  private readonly caseMap = new Map<string, string>();
  private readonly parser = new TrailerParser();

  constructor(private readonly config: LoreConfig) {
    this.loadDefinitions();
    this.validateOperationalModes();
  }

  get name(): string {
    return this.config.protocol.name;
  }

  get version(): string {
    return this.config.protocol.version;
  }

  get identityKey(): string {
    return LORE_IDENTITY_KEY;
  }

  get namespace(): string {
    // Lore stays at the root to honor standard trailer conventions.
    return '';
  }

  get isPermissive(): boolean {
    return this.config.trailers.permissive;
  }

  get isExclusive(): boolean {
    // Lore is exclusive by default: it owns its identity and defined trailers.
    return true;
  }

  private validateOperationalModes(): void {
    // Note: It is valid for a protocol to be both exclusive (owning its keys)
    // and permissive (allowing others). This is the default for Lore.
  }

  /**
   * Returns true if this protocol explicitly defines/owns the given trailer key.
   * Handles namespace-aware matching.
   */
  owns(key: string): boolean {
    const { namespace, baseKey } = this.splitKey(key);

    // We only own keys that match our namespace
    if (namespace.toLowerCase() !== this.namespace.toLowerCase()) {
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
    return `^${prefix}${this.identityKey}: [0-9a-f]{8}`;
  }

  /**
   * Translates generic filters into specific Git grep arguments.
   * @param filters Key-value pairs to match.
   */
  getSearchGrep(filters: Record<string, string | string[]>): string[] {
    const args: string[] = [];
    const prefix = this.namespace ? `${this.namespace}/` : '';

    for (const [key, value] of Object.entries(filters)) {
      // Map common aliased keys (e.g., confidence -> Confidence)
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
        // If we own the key but it's missing, the filter (which expects a value) fails.
        // If we don't own it (permissive ad-hoc), we ignore the absence.
        if (this.owns(key)) {
          return false;
        }
        continue;
      }

      // Match logic: at least one filter value must be present in actual values
      const matched = filterValues.some((fv) => 
        actualValues.some((av) => av.toLowerCase() === fv.toLowerCase())
      );

      if (!matched) return false;
    }

    return true;
  }

  /**
   * Parse raw trailers into a protocol-specific state.
   */
  parse(
    rawTrailers: string,
    unclaimedKeys?: Set<string>,
  ): {
    readonly name: string;
    readonly version: string;
    readonly identityKey: string;
    readonly trailers: Record<string, readonly string[]>;
  } {
    const rawMap = this.parser.parse(rawTrailers);
    const normalized: Record<string, string[]> = {};

    for (const [key, values] of Object.entries(rawMap)) {
      // Logic refined for Multi-protocol claim hierarchy:
      // 1. If we OWN the key (defined in our schema), we parse it.
      // 2. If we are PERMISSIVE, we parse it ONLY if it is unclaimed by any protocol schema.

      const isOwner = this.owns(key);
      const isAvailable = !unclaimedKeys || unclaimedKeys.has(key);

      if (!isOwner && (!this.isPermissive || !isAvailable)) {
        continue;
      }

      // Authorize using the baseKey (as definitions are not namespaced internally)
      const authorizedKey = this.authorize(key);
      if (!authorizedKey) continue;

      const def = this.getDefinition(authorizedKey);

      for (const value of values) {
        // Special handling for enums: validate value if possible
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
   * Format: "Namespace/Key" or "Key"
   */
  private splitKey(key: string): { namespace: string; baseKey: string } {
    const parts = key.split('/');
    if (parts.length > 1) {
      return { namespace: parts[0], baseKey: parts.slice(1).join('/') };
    }
    return { namespace: '', baseKey: key };
  }

  /**
   * Check if an ID is valid according to this protocol's rules.
   */
  isValidIdentity(id: string): boolean {
    return LORE_ID_PATTERN.test(id);
  }

  /**
   * Check if a commit's raw trailers belong to this protocol.
   * A commit belongs to Lore if it contains a Lore-id trailer.
   */
  claims(rawTrailers: string): boolean {
    const lines = rawTrailers.split('\n');
    const pattern = new RegExp(`^${this.identityKey}:`, 'i');
    return lines.some((line) => pattern.test(line));
  }

  /**
   * Get Git grep arguments to find commits belonging to this protocol.
   * Lore commits are discovered by looking for the identity trailer.
   */
  getDiscoveryGrep(): string[] {
    return [`--grep=^${this.identityKey}: [0-9a-f]{8}`];
  }

  private loadDefinitions(): void {
    // 1. Load Core Trailers
    for (const [key, def] of Object.entries(CORE_TRAILER_DEFINITIONS)) {
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
   * Returns the canonical casing of the key if authorized, otherwise null.
   */
  authorize(key: string): TrailerKey | string | null {
    // 1. Case-insensitive match against known definitions
    const canonicalKey = this.caseMap.get(key.toLowerCase());
    if (canonicalKey) {
      return canonicalKey as TrailerKey;
    }

    // 2. If not defined, check permissive mode
    if (this.isPermissive) {
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
   * Returns true if the key belongs to the core Lore protocol.
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

  /**
   * Returns a unified view of all trailer definitions for UI rendering.
   */
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
        directives: def.directives ?? [],
        ui: def.ui,
      };
    }
    return result;
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
