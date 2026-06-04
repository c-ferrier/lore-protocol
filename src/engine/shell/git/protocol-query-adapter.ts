import type { ActiveProtocol } from '../../core/models/active-protocol.js';
import type { QualifiedFilter, FilterOperator } from '../../core/types/query.js';
import type { ProtocolState } from '../../core/types/domain.js';
import { escapeRegex } from '../../util/regex.js';

/**
 * Functional adapter to translate Protocol domain logic into Git CLI arguments
 * and memory matching logic.
 */
export class ProtocolQueryAdapter {
  constructor(private readonly protocol: ActiveProtocol) {}

  /**
   * Generates regex patterns to find commits belonging to this protocol.
   * STRICT SEGMENTATION: 
   * - Namespaced: Must start with "Namespace: "
   * - Root: Must start with "identityKey: " + its regex pattern if available.
   */
  getDiscoveryPatterns(): string[] {
    const { storageNamespace, identityKey } = this.protocol;
    if (storageNamespace !== '') {
        return [`^${escapeRegex(storageNamespace)}:`];
    }

    const def = this.protocol.getDefinition(identityKey);
    let pattern = `^${escapeRegex(identityKey)}: `;
    
    // Include the identity pattern if available, or fallback to exact match to satisfy discovery tests
    if (def?.pattern) {
        const cleanPattern = def.pattern.replace(/^\^/, '').replace(/\$$/, '');
        pattern += cleanPattern;
    }
    
    return [pattern];
  }

  /**
   * Generates a specific pattern to find a single identity.
   */
  getIdentityPattern(id: string): string {
      const { storageNamespace, identityKey } = this.protocol;
      const prefix = storageNamespace !== '' ? `${storageNamespace}: ` : '';
      return `^${escapeRegex(prefix)}${escapeRegex(identityKey)}: ${escapeRegex(id)}$`;
  }

  /**
   * Translates structured filters into git log grep patterns.
   */
  getSearchPatterns(filters: readonly QualifiedFilter[]): string[][] {
    const patterns: string[] = [];
    const prefix = this.protocol.storageNamespace !== '' 
        ? `${this.protocol.storageNamespace}: ` 
        : '';

    for (const filter of filters) {
      // 1. Authorize the key for this protocol
      const authorizedKey = this.protocol.authorize(filter.key);
      if (!authorizedKey) continue;

      // 2. Format based on operator
      if (filter.op === 'has') {
        patterns.push(`^${escapeRegex(prefix)}${escapeRegex(authorizedKey)}:`);
      } else if (filter.op === 'eq') {
        const values = Array.isArray(filter.value) ? filter.value : [filter.value];
        for (const val of values) {
           // Rule: Exact match for the value part (to satisfy contract tests).
           // If users want fuzzy, they should use different operators.
           patterns.push(`^${escapeRegex(prefix)}${escapeRegex(authorizedKey)}: ${escapeRegex(String(val))}`);
        }
      }
    }

    return patterns.length > 0 ? [patterns] : [];
  }

  /**
   * Evaluates if a protocol state matches a set of filters.
   */
  matches(state: ProtocolState, filters: readonly QualifiedFilter[]): boolean {
    for (const filter of filters) {
      // 1. Protocol scope check
      if (filter.protocol !== null && filter.protocol.toLowerCase() !== this.protocol.name) {
        continue;
      }

      // 2. Ownership check: If we don't own it and it's root search, ignore it (always matches)
      if (!this.protocol.owns(filter.key) && filter.protocol === null) {
          continue;
      }

      // 3. Authorization check
      const authorizedKey = this.protocol.authorize(filter.key);
      if (!authorizedKey) return false;

      // 4. Value evaluation
      const actualValues = state.trailers[authorizedKey] || [];
      if (!this.evaluateFilter(actualValues, filter.op, filter.value)) {
          return false;
      }
    }

    return true;
  }

  private evaluateFilter(actual: readonly string[], op: FilterOperator, expected: any): boolean {
    const expectedValues = Array.isArray(expected) ? expected : [expected];
    const lowerActual = actual.map(v => v.toLowerCase());

    switch (op) {
      case 'eq':
        return expectedValues.some(ev => lowerActual.includes(String(ev).toLowerCase()));
      case 'has':
        return actual.length > 0;
      default:
        return false;
    }
  }

  /**
   * Determines if this protocol claims a block of raw trailers.
   */
  claims(rawTrailers: string): boolean {
    const { storageNamespace, identityKey } = this.protocol;
    const lines = rawTrailers.split('\n');

    if (storageNamespace !== '') {
        const pattern = new RegExp(`^${escapeRegex(storageNamespace)}:`, 'i');
        return lines.some(l => pattern.test(l));
    }

    const idPattern = new RegExp(`^${escapeRegex(identityKey)}:`, 'i');
    return lines.some(l => idPattern.test(l));
  }
}
