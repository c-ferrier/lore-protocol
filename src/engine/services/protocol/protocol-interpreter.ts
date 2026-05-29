import type { IProtocolInterpreter } from '../../interfaces/protocol/protocol-interpreter.js';
import type { ProtocolState, Atom, SupersessionStatus, StaleReason, Trailers } from '../../types/domain.js';
import type { IProtocol } from '../../interfaces/protocol.js';
import type { TrailerParser } from '../trailer-parser.js';
import type { StaleIfCondition } from '../../types/config.js';
import { TriggerParser, parseTriggerHints } from '../../util/trigger-parser.js';
import { STALE_SIGNAL } from '../../util/constants.js';

/**
 * Implementation of the Protocol Interpreter capability.
 * Owns parsing, normalization, and identity extraction.
 * 
 * Also acts as the Declarative Rules Engine for staleness evaluation.
 */
export class ProtocolInterpreter implements IProtocolInterpreter {
  constructor(
    private readonly protocol: IProtocol,
    private readonly parser: TrailerParser
  ) {}

  parse(rawTrailers: string, claimedKeys?: Set<string>): ProtocolState {
    const rawMap = this.parser.parse(rawTrailers);
    return this.normalize(rawMap, claimedKeys);
  }

  normalize(rawMap: Trailers, claimedKeys?: Set<string>): ProtocolState {
    const normalized: Record<string, string[]> = {};
    const unauthorized: Record<string, string[]> = {};
    const lowerClaimed = new Set(Array.from(claimedKeys || []).map(k => k.toLowerCase()));
    const { namespace } = this.protocol;

    // 1. Identify context: are we being handed a global map or a pre-bucketed namespace map?
    const isPreBucketed = namespace !== '' && !Object.keys(rawMap).some(k => k.toLowerCase() === namespace.toLowerCase());

    for (const [key, values] of Object.entries(rawMap)) {
      const lowerKey = key.toLowerCase();
      const isOwner = this.protocol.owns(key);
      const isReserved = lowerClaimed.has(lowerKey);

      // Logic for Namespaced Protocol (Global Path)
      if (namespace !== '' && !isPreBucketed) {
        if (!isOwner) continue;

        // Unpack nested values: "Key: value"
        for (const nestedRaw of values) {
          const match = nestedRaw.match(/^([A-Za-z0-9][A-Za-z0-9-]*):\s*(.*)$/);
          if (!match) {
            const existing = unauthorized['invalid-format'] || [];
            unauthorized['invalid-format'] = [...existing, nestedRaw];
            continue;
          }

          const innerKey = match[1];
          const innerValue = match[2];
          const authorizedKey = this.protocol.authorize(innerKey);

          if (authorizedKey) {
            const existing = normalized[authorizedKey] ?? [];
            existing.push(innerValue);
            normalized[authorizedKey] = existing;
          } else {
            // Intended for us (namespaced) but not in schema
            const existing = unauthorized[innerKey] || [];
            unauthorized[innerKey] = [...existing, innerValue];
          }
        }
        continue;
      }

      // Logic for Root Namespace OR Pre-Bucketed Namespaced Protocol
      const authorizedKey = this.protocol.authorize(key);
      if (authorizedKey && (isOwner || isPreBucketed)) {
          const existing = normalized[authorizedKey] ?? [];
          existing.push(...values);
          normalized[authorizedKey] = existing;
          continue;
      }

      // Handle orphans (not claimed by any namespace or root schema)
      if (!isReserved) {
        if (this.protocol.permissive) {
          const existing = normalized[key] ?? [];
          existing.push(...values);
          normalized[key] = existing;
        } else if (isOwner || isPreBucketed || namespace === '') {
          // If it's in our namespace bucket (or we are root) but not authorized, it's a typo
          const existing = unauthorized[key] || [];
          unauthorized[key] = [...existing, ...values];
        }
      }
    }

    return {
      trailers: normalized,
      unauthorized,
    };
  }

  getIdentity(state?: ProtocolState | null): string | null {
    if (!state) return null;
    const values = state.trailers[this.protocol.identityKey];
    if (!values || values.length === 0) return null;
    return values[0];
  }

  isValidIdentity(id: string): boolean {
    const identityDef = this.protocol.getDefinition(this.protocol.identityKey);
    if (identityDef?.validation === 'pattern' && identityDef.pattern) {
      return new RegExp(identityDef.pattern).test(id);
    }
    return id.length > 0;
  }

  /**
   * Evaluates declarative staleness triggers defined in the protocol schema.
   * Standardizes on structured object DSL to avoid string parsing overhead.
   */
  getStaleSignals(
    atom: Atom,
    now: Date,
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>,
  ): StaleReason[] {
    const reasons: StaleReason[] = [];
    const state = atom.protocols.get(this.protocol.name.toLowerCase());
    if (!state) return reasons;

    for (const key of this.protocol.getAuthorizedKeys()) {
      const def = this.protocol.getDefinition(key);
      if (!def?.stale_if) continue;

      const conditions = Array.isArray(def.stale_if) ? def.stale_if : [def.stale_if];
      const values = state.trailers[key] || [];

      for (const value of values) {
        for (const condition of conditions) {
          const reason = this.evaluateCondition(condition, state, key, value, now, globalSupersessionMap);
          if (reason) reasons.push(reason);
        }
      }
    }

    return reasons;
  }

  private evaluateCondition(
    condition: StaleIfCondition,
    state: ProtocolState,
    key: string,
    value: string,
    now: Date,
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>
  ): StaleReason | null {
    switch (condition.kind) {
      case 'value-equals': {
        const cleanValue = TriggerParser.strip(value);
        if (cleanValue === condition.value) {
          return {
            signal: condition.signal || STALE_SIGNAL.VALUE_MATCH,
            description: `[${this.protocol.name}] Atom is marked as ${key}: ${condition.value}`
          };
        }
        break;
      }

      case 'date-expired': {
        const hints = parseTriggerHints(value);
        if (hints.until && now > hints.until) {
          return {
            signal: condition.signal || STALE_SIGNAL.EXPIRED_HINT,
            description: `[${this.protocol.name}] ${key} "${value}" has expired`
          };
        }
        break;
      }

      case 'reference-superseded': {
        try {
          const currentId = this.getIdentity(state);
          let targetId = value;
          let targetPName = this.protocol.name.toLowerCase();

          if (value.includes('/')) {
            const [prefix, suffix] = value.split('/', 2);
            targetPName = prefix.toLowerCase();
            targetId = suffix;
          }

          const targetStatusMap = globalSupersessionMap.get(targetPName);
          const status = targetStatusMap?.get(targetId);

          // Only stale if the target is superseded by SOMEONE ELSE (not us)
          if (status?.superseded && status.supersededBy !== currentId && status.supersededBy !== `${this.protocol.name.toLowerCase()}/${currentId}`) {
            return {
              signal: condition.signal || STALE_SIGNAL.ORPHANED_DEP,
              description: `[${this.protocol.name}] Dependency "${value}" (in ${key}) has been superseded by ${status.supersededBy}`,
            };
          }
        } catch {
          // ignore
        }
        break;
      }
    }

    return null;
  }
}
