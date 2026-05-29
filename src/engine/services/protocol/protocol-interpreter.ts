import type { IProtocolInterpreter } from '../../interfaces/protocol/protocol-interpreter.js';
import type { ProtocolState, Atom, SupersessionStatus, StaleReason, Trailers } from '../../types/domain.js';
import type { IProtocol } from '../../interfaces/protocol.js';
import type { TrailerParser } from '../trailer-parser.js';

/**
 * Implementation of the Protocol Interpreter capability.
 * Owns parsing, normalization, and identity extraction.
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
    const { namespace, name } = this.protocol;

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

  getStaleSignals(
    atom: Atom,
    now: Date,
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>,
  ): StaleReason[] {
    // This hook is typically implemented by the specific protocol definition (e.g. Lore)
    // Here we can delegate back to the Facade if it has it, or just return empty.
    // For the Engine's generic Protocol implementation, it might have a hook.
    // Since we can't easily see the definition here without more refactoring,
    // we'll assume the Facade will handle this or we'll pass it in.
    
    // In our case, Protocol class will delegate this.
    return [];
  }
}
