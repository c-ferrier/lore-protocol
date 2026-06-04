import type { Atom } from '../types/domain.js';
import type { SearchOptions, QualifiedFilter, FilterOperator } from '../types/query.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';
import { escapeRegex } from '../../util/regex.js';
import { matchesFilters, getSearchPatterns } from '../../shell/git/protocol-query-adapter.js';
import { ownsKey } from './ownership.js';

/**
 * Normalizes raw filter inputs into a structured QualifiedFilter AST.
 * 
 * Format: "protocol/key:op=value" or "key=value"
 */
export function resolveFilterStrings(filterStrings: string[], registry: ProtocolRegistry): QualifiedFilter[] {
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
  return resolveFilters(rawMap, registry);
}

/**
 * Resolves a flat map of filter criteria into a structured AST.
 */
export function resolveFilters(raw: Record<string, any>, registry: ProtocolRegistry): QualifiedFilter[] {
  const filters: QualifiedFilter[] = [];

  for (const [rawKey, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue;

    let { protocol, key, op } = parseFilterKey(rawKey);

    // Deterministic Routing: If unqualified, resolve the owner from the registry
    if (!protocol) {
        const owner = registry.resolveKey(key);
        if (owner) {
            protocol = owner.def.name.toLowerCase();
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
 */
function parseFilterKey(raw: string): { protocol: string | null, key: string, op: FilterOperator } {
  let protocol: string | null = null;
  let key = raw;
  let op: FilterOperator = 'eq';

  // 1. Extract Operator (suffix)
  if (key.includes(':')) {
    const parts = key.split(':');
    key = parts[0];
    const opStr = parts[1].toLowerCase();
    
    if (opStr === 'eq' || opStr === 'has') {
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

/**
 * Applies authoritative application-level filtering to a collection of atoms.
 */
export function filterAtoms(atoms: readonly Atom[], options: SearchOptions, registry: ProtocolRegistry): Atom[] {
  return atoms.filter((atom) => atomMatchesOptions(atom, options, registry));
}

function atomMatchesOptions(atom: Atom, options: SearchOptions, registry: ProtocolRegistry): boolean {
  // 1. Trailer presence filter (--has)
  if (options.has) {
    // Check if any protocol in the atom contains this trailer key
    const pStates = Array.from(atom.protocols.values());

    const hasTrailer = pStates.some(
      (state) => (state.trailers[options.has!] || []).length > 0
    );
    if (!hasTrailer) return false;
  }

  // 2. Author filter
  if (options.author) {
    const authorLower = options.author.toLowerCase();
    if (!atom.author.toLowerCase().includes(authorLower)) return false;
  }

  // 3. Intent/Scope filter
  if (options.scope) {
    const extractedScope = extractScope(atom.subject);
    if (!extractedScope) return false;

    // If options.scope looks like a regex pattern (from AtomRepository), test it
    if (options.scope.includes('^') || options.scope.includes('\\')) {
      try {
        const regex = new RegExp(options.scope, 'i');
        if (!regex.test(atom.subject)) return false;
      } catch {
        // Fallback to simple comparison if regex is invalid
        if (extractedScope.toLowerCase() !== options.scope.toLowerCase()) return false;
      }
    } else {
      // Simple string comparison for raw scope names
      if (extractedScope.toLowerCase() !== options.scope.toLowerCase()) return false;
    }
  }

  // 4. Date filters
  if (options.sinceDate && atom.date < options.sinceDate) return false;
  if (options.untilDate && atom.date > options.untilDate) return false;

  // 5. Full text search
  if (options.text && !atomMatchesText(atom, options.text)) {
    return false;
  }

  // 6. Structured Semantic Filtering (Phase 2 AST)
  const rawFilters = options.filters || [];
  const filters = Array.isArray(rawFilters) ? rawFilters : resolveFilters(rawFilters, registry);

  if (filters.length > 0) {
    for (const filter of filters) {
      let filterMatched = false;

      // A. Explicitly Qualified Filter (e.g. project/status)
      if (filter.protocol) {
        const protocolName = filter.protocol;
        const state = atom.protocols.get(protocolName);
        const ctx = registry.get(protocolName);
        
        if (ctx && state && matchesFilters(state, [filter], ctx)) {
          filterMatched = true;
        }
      } 
      // B. Unqualified Filter (e.g. status)
      else {
        // Try all protocols that claimed this atom, but only those that own the key
        for (const [name, state] of atom.protocols) {
          const ctx = registry.get(name);
          if (ctx && ownsKey(filter.key, ctx)) {
            if (matchesFilters(state, [filter], ctx)) {
              filterMatched = true;
              break;
            }
          }
        }
      }

      if (!filterMatched) return false;
    }
  }

  return true;
}

/**
 * Check if an atom matches a text query across intent, body, and trailer values.
 */
function atomMatchesText(atom: Atom, query: string): boolean {
  const textLower = query.toLowerCase();

  if (atom.subject.toLowerCase().includes(textLower)) return true;
  if (atom.body.toLowerCase().includes(textLower)) return true;

  // Search all trailers in all protocols uniformly
  const pStates = Array.from(atom.protocols.values());

  for (const state of pStates) {
    for (const values of Object.values(state.trailers)) {
      for (const value of values) {
        if (value.toLowerCase().includes(textLower)) return true;
      }
    }
  }

  return false;
}

/**
 * Extract the scope from a conventional commit subject line.
 */
function extractScope(subject: string): string | null {
  const match = subject.match(/^[a-zA-Z]+\(([^)]+)\)/);
  return match ? match[1] : null;
}
