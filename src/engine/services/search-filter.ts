import type { Atom } from '../types/domain.js';
import type { SearchOptions } from '../types/query.js';
import type { ProtocolRegistry } from './protocol-registry.js';
import { FilterResolver } from './filter-resolver.js';

/**
 * Applies authoritative application-level filtering to a collection of atoms.
 * 
 * GRASP: Information Expert -- knows how to match atoms against search criteria.
 * SOLID: SRP -- only responsible for filtering logic, no git interaction or formatting.
 *
 * This service provides the "Authoritative Pass" in the discovery pipeline, 
 * ensuring absolute precision after Git's coarse --grep pass.
 */
export class SearchFilter {
  constructor(private readonly protocolRegistry: ProtocolRegistry) {}

  /**
   * Apply all active search filters to the atom list.
   */
  filter(atoms: readonly Atom[], options: SearchOptions): Atom[] {
    return atoms.filter((atom) => this.matches(atom, options));
  }

  private matches(atom: Atom, options: SearchOptions): boolean {
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
      const extractedScope = this.extractScope(atom.subject);
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
    if (options.text && !this.atomMatchesText(atom, options.text)) {
      return false;
    }

    // 6. Structured Semantic Filtering (Phase 2 AST)
    const rawFilters = options.filters || [];
    const filters = Array.isArray(rawFilters) ? rawFilters : FilterResolver.resolve(rawFilters, this.protocolRegistry);

    if (filters.length > 0) {
      for (const filter of filters) {
        let filterMatched = false;

        // A. Explicitly Qualified Filter (e.g. project/status)
        if (filter.protocol) {
          const protocolName = filter.protocol.toLowerCase();
          const state = atom.protocols.get(protocolName);
          const protocol = this.protocolRegistry.get(protocolName);
          
          if (protocol && state && protocol.matches(state, [filter])) {
            filterMatched = true;
          }
        } 
        // B. Unqualified Filter (e.g. status)
        else {
          // Try all protocols that claimed this atom, but only those that own the key
          for (const [name, state] of atom.protocols) {
            const protocol = this.protocolRegistry.get(name);
            if (protocol && protocol.owns(filter.key)) {
              if (protocol.matches(state, [filter])) {
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
  private atomMatchesText(atom: Atom, query: string): boolean {
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
   * Pattern: `type(scope): description`
   * Returns null if no scope is found.
   */
  private extractScope(subject: string): string | null {
    const match = subject.match(/^[a-zA-Z]+\(([^)]+)\)/);
    return match ? match[1] : null;
  }
}
