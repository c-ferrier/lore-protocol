import type { Atom, ProtocolState } from '../types/domain.js';
import type { SearchOptions } from '../types/query.js';
import type { ProtocolRegistry } from './protocol-registry.js';

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
  applyFilters(atoms: readonly Atom[], options: SearchOptions): Atom[] {
    return atoms.filter((atom) => this.matches(atom, options));
  }

  private matches(atom: Atom, options: SearchOptions): boolean {
    // 1. Trailer presence filter (--has)
    if (options.has) {
      // Check if any protocol in the atom contains this trailer key
      const pStates = atom.protocols 
        ? Array.from(atom.protocols.values()) 
        : [{ trailers: atom.trailers }];

      const hasTrailer = pStates.some(
        (state) => (state.trailers[options.has!] || []).length > 0
      );
      if (!hasTrailer) return false;
    }

    // 2. Author filter
    // Authoritative pass: Git --author matches full "Name <email>"; Lore
    // atoms only store the email (%ae). This pass ensures consistency.
    if (options.author) {
      const authorLower = options.author.toLowerCase();
      if (!atom.author.toLowerCase().includes(authorLower)) return false;
    }

    // 3. Intent/Scope filter
    // Precise pass: Git --grep might match code snippets in the body.
    // This pass ensures we only match the actual intent line's scope.
    if (options.scope) {
      const scopeLower = options.scope.toLowerCase();
      const extractedScope = this.extractScope(atom.intent);
      if (!extractedScope || extractedScope.toLowerCase() !== scopeLower) return false;
    }

    // 4. Date filters (authoritative pass for non-git sources or edge cases)
    if (options.sinceDate && atom.date < options.sinceDate) return false;
    if (options.untilDate && atom.date > options.untilDate) return false;

    // 5. Full text search
    // Semantic pass: Git matches keywords anywhere. This pass precisely
    // checks context (intent, body, and all protocol trailers).
    if (options.text && !this.atomMatchesText(atom, options.text)) {
      return false;
    }

    // 6. Semantic Filtering (delegated to protocols)
    const filters = options.filters || {};
    if (Object.keys(filters).length > 0) {
      if (atom.protocols) {
        for (const [name, state] of atom.protocols) {
          const protocol = this.protocolRegistry.get(name);
          if (protocol && !protocol.matches(state, filters)) {
            return false;
          }
        }
      } else {
        // Fallback for deprecated structure: assume primary protocol can match against root trailers
        const primary = this.protocolRegistry.all()[0];
        if (primary) {
          const state: ProtocolState = {
            name: primary.name,
            version: primary.version,
            identityKey: primary.identityKey,
            trailers: atom.trailers,
          };
          if (!primary.matches(state, filters)) return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if an atom matches a text query across intent, body, and trailer values.
   */
  private atomMatchesText(atom: Atom, query: string): boolean {
    const textLower = query.toLowerCase();

    if (atom.intent.toLowerCase().includes(textLower)) return true;
    if (atom.body.toLowerCase().includes(textLower)) return true;

    // Search all trailers in all protocols uniformly
    const pStates = atom.protocols ? Array.from(atom.protocols.values()) : [{ trailers: atom.trailers }];

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
