import type { LoreAtom, TrailerKey } from '../types/domain.js';
import type { SearchOptions } from '../types/query.js';

/**
 * Applies authoritative application-level filtering to a collection of Lore atoms.
 * 
 * GRASP: Information Expert -- knows how to match atoms against search criteria.
 * SOLID: SRP -- only responsible for filtering logic, no git interaction or formatting.
 *
 * This service provides the "Authoritative Pass" in the discovery pipeline, 
 * ensuring absolute precision after Git's coarse --grep pass.
 */
export class SearchFilter {
  /**
   * Apply all active search filters to the atom list.
   */
  applyFilters(atoms: readonly LoreAtom[], options: SearchOptions): LoreAtom[] {
    return atoms.filter((atom) => this.matches(atom, options));
  }

  private matches(atom: LoreAtom, options: SearchOptions): boolean {
    // 1. Trailer presence filter (--has)
    if (options.has && !this.atomHasTrailer(atom, options.has)) {
      return false;
    }

    // 2. Exact match enum filters
    // Note: Enum values are stored as single-element arrays in the flat model.
    if (options.confidence && atom.trailers.Confidence[0] !== options.confidence) {
      return false;
    }
    if (options.scopeRisk && atom.trailers['Scope-risk'][0] !== options.scopeRisk) {
      return false;
    }
    if (options.reversibility && atom.trailers.Reversibility[0] !== options.reversibility) {
      return false;
    }

    // 3. Author filter
    // Authoritative pass: Git --author matches full "Name <email>"; Lore
    // atoms only store the email (%ae). This pass ensures consistency.
    if (options.author) {
      const authorLower = options.author.toLowerCase();
      if (!atom.author.toLowerCase().includes(authorLower)) return false;
    }

    // 4. Intent/Scope filter
    // Precise pass: Git --grep might match code snippets in the body.
    // This pass ensures we only match the actual intent line's scope.
    if (options.scope) {
      const scopeLower = options.scope.toLowerCase();
      const extractedScope = this.extractScope(atom.intent);
      if (!extractedScope || extractedScope.toLowerCase() !== scopeLower) return false;
    }

    // 5. Date filters (authoritative pass for non-git sources or edge cases)
    if (options.since) {
      const sinceDate = new Date(options.since);
      if (!isNaN(sinceDate.getTime()) && atom.date < sinceDate) return false;
    }
    if (options.until) {
      const untilDate = new Date(options.until);
      if (!isNaN(untilDate.getTime()) && atom.date > untilDate) return false;
    }

    // 6. Full text search
    // Semantic pass: Git matches keywords anywhere. This pass precisely
    // checks context (intent, body, and all Lore trailers).
    if (options.text && !this.atomMatchesText(atom, options.text)) {
      return false;
    }

    return true;
  }

  /**
   * Check if an atom has a non-empty value for the given trailer key.
   */
  atomHasTrailer(atom: LoreAtom, trailerKey: TrailerKey): boolean {
    const values = atom.trailers[trailerKey] || [];
    return values.length > 0;
  }

  /**
   * Check if an atom matches a text query across intent, body, and trailer values.
   */
  private atomMatchesText(atom: LoreAtom, query: string): boolean {
    const textLower = query.toLowerCase();

    if (atom.intent.toLowerCase().includes(textLower)) return true;
    if (atom.body.toLowerCase().includes(textLower)) return true;

    // Search all trailers uniformly
    for (const key of Object.keys(atom.trailers)) {
      const values = atom.trailers[key];
      if (!values) continue;

      for (const value of values) {
        if (value.toLowerCase().includes(textLower)) return true;
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
