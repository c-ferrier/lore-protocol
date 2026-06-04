import { ProtocolMap, type ProtocolName } from './protocol-map.js';
import { ProtocolHydrator } from '../../shell/fs/protocol-hydrator.js';
import type { 
    ProtocolDefinition, 
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
  private readonly caseMap = new Map<string, string>();

  constructor(
    private readonly definition: ProtocolDefinition
  ) {
    this.name = definition.name.toLowerCase();
    this.version = definition.version;
    this.strict = definition.strict ?? true;
    this.permissive = definition.permissive ?? false;
    this.identityKey = definition.identityKey;
    this.storageNamespace = definition.namespace || '';
    
    this.loadDefinitions();
  }

  authorize(key: string): string | null {
    const canonical = this.caseMap.get(key.toLowerCase());
    if (canonical) return canonical;
    return (this.isRoot() && this.permissive) ? key : null;
  }

  getAuthorizedKeys(): string[] {
    return Array.from(this.definitions.keys()).sort((a, b) => {
      const orderA = this.definitions.get(a)?.prompt?.order ?? 1000;
      const orderB = this.definitions.get(b)?.prompt?.order ?? 1000;
      return orderA - orderB;
    });
  }

  getScalarKeys(): string[] {
    return this.getAuthorizedKeys().filter(k => !this.getDefinition(k)?.multivalue);
  }

  getListKeys(): string[] {
    return this.getAuthorizedKeys().filter(k => this.getDefinition(k)?.multivalue);
  }

  getDefinition(key: string): TrailerDefinition | null {
    return this.definitions.get(key) || null;
  }

  getReferenceKeys(): string[] {
    return this.getAuthorizedKeys().filter(k => this.getDefinition(k)?.validation === 'reference');
  }

  /**
   * Defines definitively what this protocol "owns" at the TOP LEVEL of the git log.
   * STRICT SEGMENTATION: 
   * - Namespaced protocols ONLY own their literal namespace key.
   * - Root protocols own their identityKey and everything in their schema.
   */
  owns(key: string): boolean {
    const lowerKey = key.toLowerCase();
    const ns = this.storageNamespace.toLowerCase();
    
    // 1. Namespaced Context
    if (ns !== '') {
        return lowerKey === ns;
    }
    
    // 2. Root Context
    if (lowerKey === this.identityKey.toLowerCase()) return true;
    if (this.caseMap.has(lowerKey)) return true;
    if (lowerKey === this.name) return true;
    
    return false;
  }

  isRoot(): boolean {
    return this.storageNamespace === '';
  }

  isValidIdentity(id: string): boolean {
    const idDef = this.definitions.get(this.identityKey);
    if (!idDef?.pattern) return true;
    return new RegExp(idDef.pattern).test(id);
  }

  parse(raw: string, claimedKeys?: Set<string>): ProtocolState {
    const rawMap = TriggerParser.parseTrailers(raw);
    return this.normalize(rawMap, claimedKeys);
  }

  /**
   * Normalizes trailers using the Strict Segmented Waterfall.
   */
  normalize(rawMap: Record<string, readonly string[]>, claimedKeys?: Set<string>): ProtocolState {
    const normalized: Record<string, string[]> = {};
    const unauthorized: Record<string, string[]> = {};
    const namespace = this.storageNamespace;
    const lowerClaimed = new Set(Array.from(claimedKeys || []).map(k => k.toLowerCase()));

    for (const [key, values] of Object.entries(rawMap)) {
      const lowerKey = key.toLowerCase();
      const isPreBucketed = namespace !== '' && lowerKey === namespace.toLowerCase();

      // CASE 1: Namespaced Bucket
      if (isPreBucketed) {
        for (const nestedRaw of values) {
          const match = nestedRaw.match(/^([A-Za-z0-9][A-Za-z0-9-]*):\s*(.*)$/);
          if (!match) {
            unauthorized['invalid-format'] = [...(unauthorized['invalid-format'] || []), nestedRaw];
            continue;
          }
          const innerKey = match[1];
          const innerValue = match[2];
          const lowerInnerKey = innerKey.toLowerCase();
          
          const authorizedKey = this.caseMap.get(lowerInnerKey);
          if (authorizedKey) {
            // Rule B: Strict claim within namespace
            normalized[authorizedKey] = [...(normalized[authorizedKey] || []), innerValue];
          } else if (this.permissive) {
            // Rule C: Permissive fallback for this namespace
            normalized[innerKey] = [...(normalized[innerKey] || []), innerValue];
          } else {
            // Strictly unauthorized within our bucket
            unauthorized[innerKey] = [...(unauthorized[innerKey] || []), innerValue];
          }
        }
        continue;
      }

      // CASE 2: Global/Root Context
      // STRICT SEGMENTATION: Namespaced protocols ignore EVERYTHING at the top level.
      if (!this.isRoot()) {
          continue;
      }

      const isOwner = this.owns(key);
      const authorizedKey = this.authorize(key);

      // Rule: Root protocol ignores things that look like qualified trailers (A: B: c)
      if (!isOwner && values.some(v => v.includes(':'))) {
          continue;
      }

      // Root Sovereignty
      if (authorizedKey && (!lowerClaimed.has(lowerKey) || isOwner)) {
          const inSchema = this.definitions.has(authorizedKey);
          if (inSchema || this.permissive) {
            normalized[authorizedKey] = [...(normalized[authorizedKey] || []), ...values];
            continue;
          }
      }

      // Root Catch-all (Rule 2.2: if permissive and unclaimed)
      if (this.permissive && !lowerClaimed.has(lowerKey)) {
          normalized[key] = [...(normalized[key] || []), ...values];
          continue;
      }

      // Root Strictly Unauthorized (typos)
      if (!lowerClaimed.has(lowerKey)) {
          unauthorized[key] = [...(unauthorized[key] || []), ...values];
      }
    }

    return { trailers: normalized, unauthorized };
  }

  getIdentity(state?: ProtocolState | null): string | null {
    if (!state) return null;
    const values = state.trailers[this.identityKey];
    if (!values || values.length === 0) return null;
    return values[0];
  }

  validateState(state: ProtocolState, resolver?: IIdentityResolver): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const keys = this.getAuthorizedKeys();

    for (const key of keys) {
      const def = this.getDefinition(key);
      const values = state.trailers[key] || [];

      if (def?.required && values.length === 0) {
          issues.push({
            severity: (key === this.identityKey || this.strict) ? 'error' : 'warning',
            rule: (key === this.identityKey) ? `${this.name.toLowerCase().replace(/-/g, '')}-id-present` : 'required-trailer',
            field: this.storageNamespace !== '' && key !== this.storageNamespace ? `${this.storageNamespace}:${key}` : key,
            message: `[${this.name}] Required trailer missing: "${key}"`,
          });
      }

      if (def?.multivalue === false && values.length > 1) {
          issues.push({
            severity: 'error',
            rule: 'invalid-cardinality',
            field: key,
            message: `[${this.name}] Trailer "${key}" allows only one value (got ${values.length})`,
          });
      }

      for (const value of values) {
        const result = this.validateTrailer(key, value, resolver);
        if (!result.valid) {
          issues.push({
            severity: (key === this.identityKey || this.strict) ? 'error' : 'warning',
            rule: result.rule || 'invalid-format',
            field: key,
            message: result.message || `[${this.name}] Invalid value for "${key}": "${value}"`,
          });
        }
      }
    }

    if (!this.permissive) {
      for (const [key] of Object.entries(state.unauthorized)) {
          issues.push({
            severity: 'error',
            rule: 'unauthorized-trailer',
            field: this.storageNamespace !== '' && key !== this.storageNamespace ? `${this.storageNamespace}:${key}` : key,
            message: `[${this.name}] Trailer "${key}" is not recognized by protocol schema`,
          });
      }
    }
    return issues;
  }

  validateTrailer(key: string, value: string, resolver?: IIdentityResolver): { valid: boolean; message?: string; rule?: string } {
    const def = this.getDefinition(key);
    if (!def) return { valid: true };

    if (def.validation === 'values' && def.values) {
      if (!Object.keys(def.values).includes(value)) {
        return {
          valid: false,
          rule: 'invalid-enum',
          message: `[${this.name}] Invalid value for "${key}": "${value}". Expected one of: ${Object.keys(def.values).join(', ')}`,
        };
      }
    }

    if (def.validation === 'pattern' && def.pattern) {
      if (!new RegExp(def.pattern).test(value)) {
        let rule = 'invalid-format';
        let message = `[${this.name}] Value for "${key}" does not match pattern: ${def.pattern}`;
        if (key === this.identityKey) {
            rule = `${this.name.toLowerCase().replace(/-/g, '')}-id-format`;
            message = `[${this.name}] ${this.identityKey} "${value}" is not a valid identifier`;
        }
        return { valid: false, rule, message };
      }
    }

    if (def.validation === 'reference') {
      let targetPName = this.name;
      let targetId = value;

      if (value.includes('/')) {
        const [prefix, suffix] = value.split('/', 2);
        targetPName = prefix.toLowerCase();
        targetId = suffix;
      }

      const isLocal = targetPName === this.name;

      if (def.crossProtocol === false && !isLocal) {
        return {
          valid: false,
          rule: 'cross-protocol-prohibited',
          message: `[${this.name}] Trailer "${key}" does not allow cross-protocol references (got "${targetPName}")`,
        };
      }

      if (isLocal) {
        return this.isValidIdentity(targetId) ? { valid: true } : {
          valid: false,
          rule: 'reference-format',
          message: `[${this.name}] Invalid reference format in ${key}: "${value}".`,
        };
      }

      if (!resolver) {
        return {
          valid: false,
          rule: 'unknown-protocol-prefix',
          message: `[${this.name}] Unknown protocol prefix: "${targetPName}" (Resolver not linked)`,
        };
      }

      try {
        const identity = resolver.resolveIdentity(value, this.name);
        if (!identity) return { valid: false, rule: 'unknown-protocol-prefix' };

        const targetP = resolver.get(identity.protocol || this.name);
        if (targetP && !targetP.isValidIdentity(identity.id)) {
            return {
                valid: false,
                rule: 'invalid-reference-format',
                message: `[${this.name}] Reference "${value}" is not a valid identifier for protocol "${targetP.name}"`
            };
        }

        return { valid: true };
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
      this.caseMap.set(key.toLowerCase(), key);
    }
  }
}
