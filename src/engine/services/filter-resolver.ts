import type { QualifiedFilter, FilterOperator } from '../types/query.js';
import type { ProtocolRegistry } from './protocol-registry.js';

/**
 * Normalizes raw filter inputs into a structured QualifiedFilter AST.
 * 
 * DESIGN: This utility acts as the "Input Adapter" for the query engine.
 * It handles parsing of qualified keys (protocol/key:op) into formal AST nodes.
 */
export class FilterResolver {
  /**
   * Resolves an array of CLI filter strings into a structured AST.
   * Format: "protocol/key:op=value" or "key=value"
   */
  static resolveStrings(filterStrings: string[], registry: ProtocolRegistry): QualifiedFilter[] {
    const rawMap: Record<string, string> = {};
    for (const f of filterStrings) {
      const idx = f.indexOf('=');
      if (idx === -1) {
        // Assume existence check if no value provided
        rawMap[`${f}:has`] = 'true';
      } else {
        const rawKey = f.substring(0, idx).trim();
        const value = f.substring(idx + 1).trim();
        rawMap[rawKey] = value;
      }
    }
    return this.resolve(rawMap, registry);
  }

  /**
   * Resolves a flat map of filter criteria into a structured AST.
   */
  static resolve(raw: Record<string, any>, registry: ProtocolRegistry): QualifiedFilter[] {
    const filters: QualifiedFilter[] = [];

    for (const [rawKey, value] of Object.entries(raw)) {
      if (value === undefined || value === null) continue;

      let { protocol, key, op } = this.parseKey(rawKey);

      // Deterministic Routing: If unqualified, resolve the owner from the registry
      if (!protocol) {
          const owner = registry.resolveKey(key);
          if (owner) {
              protocol = owner.name.toLowerCase();
          }
      }
      
      filters.push({
        protocol,
        key,
        op,
        value
      });
    }

    return filters;
  }

  /**
   * Parses a raw key string into its AST components.
   * Formats supported:
   *  - "key" (unqualified, op: eq)
   *  - "protocol/key" (qualified, op: eq)
   *  - "key:op" (unqualified, specific op)
   *  - "protocol/key:op" (qualified, specific op)
   */
  private static parseKey(raw: string): { protocol: string | null, key: string, op: FilterOperator } {
    let protocol: string | null = null;
    let key = raw;
    let op: FilterOperator = 'eq';

    // 1. Extract Operator (suffix)
    if (key.includes(':')) {
      const parts = key.split(':');
      key = parts[0];
      const opStr = parts[1].toLowerCase();
      
      // Validate operator
      if (this.isValidOperator(opStr)) {
        op = opStr as FilterOperator;
      }
    }

    // 2. Extract Protocol (prefix)
    if (key.includes('/')) {
      const parts = key.split('/');
      protocol = parts[0];
      key = parts[1];
    }

    return { protocol, key, op };
  }

  private static isValidOperator(op: string): boolean {
    const valid = ['eq']; // , 'ne', 'in', 'nin', 're', 'gt', 'lt', 'has'];
    return valid.includes(op);
  }
}
