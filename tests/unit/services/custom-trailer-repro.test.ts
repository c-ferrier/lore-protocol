import { describe, it, expect } from 'vitest';
import { SearchFilter } from '../../../src/services/search-filter.js';
import { TextFormatter } from '../../../src/formatters/text-formatter.js';
import { CustomTrailerCollection } from '../../../src/types/custom-trailer-collection.js';
import type { LoreAtom, LoreTrailers } from '../../../src/types/domain.js';
import type { FormattableQueryResult } from '../../../src/types/output.js';

function makeTrailers(overrides: Partial<LoreTrailers> = {}): LoreTrailers {
  return {
    'Lore-id': overrides['Lore-id'] ?? 'a1b2c3d4',
    Constraint: overrides.Constraint ?? [],
    Rejected: overrides.Rejected ?? [],
    Confidence: overrides.Confidence ?? null,
    'Scope-risk': overrides['Scope-risk'] ?? null,
    Reversibility: overrides.Reversibility ?? null,
    Directive: overrides.Directive ?? [],
    Tested: overrides.Tested ?? [],
    'Not-tested': overrides['Not-tested'] ?? [],
    Supersedes: overrides.Supersedes ?? [],
    'Depends-on': overrides['Depends-on'] ?? [],
    Related: overrides.Related ?? [],
    custom: overrides.custom ?? CustomTrailerCollection.empty(),
  };
}

function makeAtom(overrides: Partial<LoreAtom> = {}): LoreAtom {
  return {
    loreId: overrides.loreId ?? 'a1b2c3d4',
    commitHash: overrides.commitHash ?? 'abc1234567890',
    date: overrides.date ?? new Date('2025-01-15T10:00:00Z'),
    author: overrides.author ?? 'alice@example.com',
    intent: overrides.intent ?? 'feat(auth): add login flow',
    body: overrides.body ?? '',
    trailers: overrides.trailers ?? makeTrailers(),
    filesChanged: overrides.filesChanged ?? ['src/auth.ts'],
  };
}

describe('Custom Trailer Support (Reproduction)', () => {
  const searchFilter = new SearchFilter();
  const textFormatter = new TextFormatter({ color: false });

  describe('SearchFilter with custom trailers', () => {
    const customTrailers = new Map<string, string[]>();
    customTrailers.set('Ticket', ['ABC-123']);
    customTrailers.set('Assisted-by', ['Gemini']);

    const atom = makeAtom({
      trailers: makeTrailers({
        custom: new CustomTrailerCollection(customTrailers),
      }),
    });

    it('should find atom when searching for custom trailer value via --text', () => {
      const results = searchFilter.applyFilters([atom], {
        confidence: null,
        scopeRisk: null,
        reversibility: null,
        has: null,
        author: null,
        scope: null,
        text: 'Gemini',
        since: null,
        until: null,
        limit: null,
        maxCommits: null,
      });

      expect(results.length).toBe(1);
    });

    it('should find atom when searching for custom trailer presence via --has', () => {
      const results = searchFilter.applyFilters([atom], {
        confidence: null,
        scopeRisk: null,
        reversibility: null,
        has: 'Ticket',
        author: null,
        scope: null,
        text: null,
        since: null,
        until: null,
        limit: null,
        maxCommits: null,
      });

      expect(results.length).toBe(1);
    });
  });

  describe('TextFormatter with custom trailers', () => {
    it('should include custom trailers in output', () => {
      const customTrailers = new Map<string, string[]>();
      customTrailers.set('Ticket', ['ABC-123']);
      
      const atom = makeAtom({
        trailers: makeTrailers({
          custom: new CustomTrailerCollection(customTrailers),
        }),
      });

      const data: FormattableQueryResult = {
        result: {
          command: 'search',
          target: 'all',
          targetType: 'search',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = textFormatter.formatQueryResult(data);
      
      expect(output).toContain('Ticket: ABC-123');
    });
  });
});
