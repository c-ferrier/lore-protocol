import type { IProtocolQueryAdapter } from '../../interfaces/protocol/protocol-query-adapter.js';
import type { ProtocolState } from '../../types/domain.js';
import type { IProtocol } from '../../interfaces/protocol.js';
import type { QualifiedFilter, FilterOperator } from '../../types/query.js';
import { escapeRegex } from '../../util/regex.js';

/**
 * Implementation of the Protocol Query Adapter capability.
 * Owns discovery patterns and search filtering.
 */
export class ProtocolQueryAdapter implements IProtocolQueryAdapter {
  constructor(private readonly protocol: IProtocol) {}

  getDiscoveryPatterns(): string[] {
    const namespace = this.protocol.getStorageNamespace();
    const { identityKey } = this.protocol;
    if (namespace !== '') {
      // Coarse pass: just find the namespace key at start of line
      return [`^${namespace}:`];
    }

    const identityDef = this.protocol.getDefinition(identityKey);
    const pattern = identityDef?.pattern || '.+';
    return [`^${identityKey}: ${pattern.replace(/^\^|\$$/g, '')}`];
  }

  getSearchPatterns(filters: readonly QualifiedFilter[]): string[][] {
    const results: string[][] = [];
    const namespace = this.protocol.getStorageNamespace();
    const { name: protocolName } = this.protocol;

    for (const filter of filters) {
      // 1. Check Protocol Sovereignty
      // Skip if the filter is explicitly qualified for a DIFFERENT protocol
      if (filter.protocol !== null && filter.protocol.toLowerCase() !== protocolName.toLowerCase()) {
        continue;
      }

      // 2. Authorize key
      const authorizedKey = this.protocol.authorize(filter.key);
      if (!authorizedKey) continue;

      // 3. Storage Pushdown (Only supported for eq)
      if (filter.op !== 'eq') {
          continue;
      }

      const values = Array.isArray(filter.value) ? filter.value : [filter.value];
      const orSet: string[] = [];

      for (const val of values) {
        const patternVal = escapeRegex(String(val));
        if (namespace !== '') {
            // Namespaced search: "^Namespace: Key: value"
            orSet.push(`^${namespace}: ${authorizedKey}: ${patternVal}`);
        } else {
            // Root search: "^Key: value"
            orSet.push(`^${authorizedKey}: ${patternVal}`);
        }
      }
      if (orSet.length > 0) {
          results.push(orSet);
      }
    }

    return results;
  }

  getIdentityPattern(id: string): string {
    const namespace = this.protocol.getStorageNamespace();
    const { identityKey } = this.protocol;
    if (namespace !== '') {
        return `^${namespace}: ${identityKey}: ${escapeRegex(id)}`;
    }
    return `^${identityKey}: ${escapeRegex(id)}`;
  }

  matches(state: ProtocolState, filters: readonly QualifiedFilter[]): boolean {
    const { name: protocolName } = this.protocol;

    for (const filter of filters) {
      // 1. Check Protocol Sovereignty
      if (filter.protocol !== null && filter.protocol.toLowerCase() !== protocolName.toLowerCase()) {
        continue;
      }

      const authorizedKey = this.protocol.authorize(filter.key);
      if (!authorizedKey) continue;

      // 2. Permissive check: skip filters for keys we don't own and aren't present
      if (this.protocol.permissive && !this.protocol.owns(filter.key) && !state.trailers[authorizedKey]) {
          continue;
      }

      const actualValues = state.trailers[authorizedKey] || [];
      if (!this.evaluate(actualValues, filter.op, filter.value)) {
          return false;
      }
    }

    return true;
  }

  private evaluate(actual: readonly string[], op: FilterOperator, expected: any): boolean {
    const expectedValues = Array.isArray(expected) ? expected : [expected];
    const lowerActual = actual.map(v => v.toLowerCase());

    switch (op) {
      case 'eq':
        return expectedValues.some(ev => lowerActual.includes(String(ev).toLowerCase()));
      
      default:
        return false;
    }
  }

  claims(rawTrailers: string): boolean {
    const namespace = this.protocol.getStorageNamespace();
    const { identityKey } = this.protocol;
    const pattern = namespace !== ''
        ? new RegExp(`^${namespace}:`, 'i')
        : new RegExp(`^${identityKey}:`, 'i');
    
    return rawTrailers.split('\n').some((line) => pattern.test(line));
  }
}
