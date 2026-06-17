import { beforeEach,describe, expect, it } from 'vitest';

import { filterAtoms, resolveFilters, resolveFilterStrings } from '../../../src/core/logic/filtering.js';
import { ProtocolMap } from '../../../src/core/models/protocol-map.js';
import type { ProtocolContext } from '../../../src/core/types/protocol-definition.js';
import { makeAtom, makeStubProtocolContext, makeStubProtocolMap, makeStubProtocolState } from '../../../src/testing.js';

describe('Filtering Logic (Pure Functions)', () => {
  let protocols: ProtocolMap<ProtocolContext>;
  let protocol: ProtocolContext;

  beforeEach(() => {
    // P1: Root protocol
    protocol = makeStubProtocolContext({
        name: 'mock',
        namespace: '',
        trailers: {
            'Mock-id': { description: 'ID', multivalue: false, validation: 'none' as const },
            'Confidence': { description: 'C', multivalue: false, validation: 'none' as const }
        }
    });

    // P2: Namespaced protocol
    const fredProtocol = makeStubProtocolContext({
        name: 'fred',
        namespace: 'fred',
        trailers: {
            'Fred-id': { description: 'ID', multivalue: false, validation: 'none' as const },
            'Team': { description: 'T', multivalue: false, validation: 'none' as const }
        }
    });

    protocols = makeStubProtocolMap([protocol, fredProtocol]);
  });

  describe('resolveFilters', () => {
    it('should resolve simple key=value pairs', () => {
      const raw = { confidence: 'high' };
      const filters = resolveFilters(raw, protocols);
      expect(filters).toEqual([
        { protocol: 'mock', key: 'confidence', op: 'eq', value: 'high' }
      ]);
    });

    it('should ignore null/undefined values', () => {
      const raw = { confidence: 'high', 'fred-id': null, team: undefined };
      const filters = resolveFilters(raw, protocols);
      expect(filters).toEqual([
        { protocol: 'mock', key: 'confidence', op: 'eq', value: 'high' }
      ]);
    });

    it('should support array values as exact matches', () => {
      const raw = { confidence: ['high', 'medium'] };
      const filters = resolveFilters(raw, protocols);
      expect(filters).toEqual([
        { protocol: 'mock', key: 'confidence', op: 'eq', value: ['high', 'medium'] }
      ]);
    });

    it('should route namespaced keys to the correct protocol', () => {
      const raw = { 'fred/team': 'alpha' };
      const filters = resolveFilters(raw, protocols);
      expect(filters).toEqual([
        { protocol: 'fred', key: 'team', op: 'eq', value: 'alpha' }
      ]);
    });

    it('should resolve un-prefixed keys by querying the registry', () => {
      const raw = { team: 'alpha' };
      const filters = resolveFilters(raw, protocols);
      expect(filters).toEqual([
        { protocol: 'fred', key: 'team', op: 'eq', value: 'alpha' }
      ]);
    });

    it('should support explicit operators (e.g. key:has)', () => {
      const raw = { 'confidence:has': 'true' };
      const filters = resolveFilters(raw, protocols);
      expect(filters).toEqual([
        { protocol: 'mock', key: 'confidence', op: 'has', value: 'true' }
      ]);
    });
  });

  describe('resolveFilterStrings', () => {
    it('should parse key=value strings into filters', () => {
      const strings = ['confidence=high', 'fred/team=alpha'];
      const filters = resolveFilterStrings(strings, protocols);
      expect(filters).toEqual([
        { protocol: 'mock', key: 'confidence', op: 'eq', value: 'high' },
        { protocol: 'fred', key: 'team', op: 'eq', value: 'alpha' }
      ]);
    });

    it('should parse strings without = as existence checks (:has)', () => {
      const strings = ['confidence'];
      const filters = resolveFilterStrings(strings, protocols);
      expect(filters).toEqual([
        { protocol: 'mock', key: 'confidence', op: 'has', value: 'true' }
      ]);
    });
  });

  describe('filterAtoms', () => {
    it('should return empty if atom does not match simple trailer filter', () => {
      const atom = makeAtom({ trailers: { 'Mock-id': ['a1'], Confidence: ['low'] } });
      const results = filterAtoms([atom], {
          filters: resolveFilters({ confidence: 'high' }, protocols)
      }, protocols);
      expect(results).toHaveLength(0);
    });

    it('should return atom if it matches simple trailer filter', () => {
      const atom = makeAtom({ trailers: { 'Mock-id': ['a1'], Confidence: ['high'] } });
      const results = filterAtoms([atom], {
          filters: resolveFilters({ confidence: 'high' }, protocols)
      }, protocols);
      expect(results).toHaveLength(1);
    });

    it('should match multiple values if array is provided', () => {
      const atom = makeAtom({ trailers: { 'Mock-id': ['a1'], Confidence: ['high'] } });
      const results = filterAtoms([atom], {
          filters: resolveFilters({ confidence: ['medium', 'high'] }, protocols)
      }, protocols);
      expect(results).toHaveLength(1);
    });

    it('should fail if any filter in an AND set fails', () => {
      const atom = makeAtom({ trailers: { 'Mock-id': ['a1'], Confidence: ['high'] } });
      const results = filterAtoms([atom], {
          filters: resolveFilters({ confidence: 'high', 'fred/team': 'alpha' }, protocols) 
      }, protocols);
      expect(results).toHaveLength(0);
    });

    it('should match --has option across any protocol', () => {
      const atom = makeAtom({ trailers: { Confidence: ['high'] } });
      const results = filterAtoms([atom], { has: 'Confidence' }, protocols);
      expect(results).toHaveLength(1);

      const resultsMiss = filterAtoms([atom], { has: 'Missing' }, protocols);
      expect(resultsMiss).toHaveLength(0);
    });

    it('should filter by author', () => {
      const atom = makeAtom({ author: 'Alice <alice@example.com>' });
      
      expect(filterAtoms([atom], { author: 'alice' }, protocols)).toHaveLength(1);
      expect(filterAtoms([atom], { author: 'bob' }, protocols)).toHaveLength(0);
    });

    it('should filter by scope name (conventional commit)', () => {
      const atom = makeAtom({ subject: 'feat(ui): add button' });
      expect(filterAtoms([atom], { scope: 'ui' }, protocols)).toHaveLength(1);
      expect(filterAtoms([atom], { scope: 'auth' }, protocols)).toHaveLength(0);
    });

    it('should support regex scope matching (Repository Pushdown Parity)', () => {
        const atom = makeAtom({ subject: 'feat(auth): login' });
        // The repository generates this pattern for 'auth' scope
        const pattern = '^[a-zA-Z]+\\(auth\\):';
        expect(filterAtoms([atom], { scope: pattern }, protocols)).toHaveLength(1);
    });

    it('should handle regex escaping in scope matching', () => {
        const atom = makeAtom({ subject: 'feat(auth): login' });
        const malicious = 'auth) | grep (';
        // Should handle gracefully (no match but no crash)
        expect(filterAtoms([atom], { scope: malicious }, protocols)).toHaveLength(0);
    });

    it('should filter by dates', () => {
      const atom = makeAtom({ date: new Date('2023-05-15T00:00:00Z') });
      
      expect(filterAtoms([atom], { sinceDate: new Date('2023-05-14T00:00:00Z') }, protocols)).toHaveLength(1);
      expect(filterAtoms([atom], { sinceDate: new Date('2023-05-16T00:00:00Z') }, protocols)).toHaveLength(0);
      
      expect(filterAtoms([atom], { untilDate: new Date('2023-05-16T00:00:00Z') }, protocols)).toHaveLength(1);
      expect(filterAtoms([atom], { untilDate: new Date('2023-05-14T00:00:00Z') }, protocols)).toHaveLength(0);
    });

    it('should search across ALL trailers for --text query', () => {
        const atom = makeAtom({ 
            subject: 'fix: bug',
            body: 'Detailed notes.'
        });
        atom.protocols.set('mock', makeStubProtocolState({ trailers: { 'Confidence': ['low'] } }));
        atom.protocols.set('fred', makeStubProtocolState({ trailers: { 'Team': ['backend'] } }));

        expect(filterAtoms([atom], { text: 'bug' }, protocols)).toHaveLength(1);
        expect(filterAtoms([atom], { text: 'notes' }, protocols)).toHaveLength(1);
        expect(filterAtoms([atom], { text: 'low' }, protocols)).toHaveLength(1);
        expect(filterAtoms([atom], { text: 'backend' }, protocols)).toHaveLength(1);
        expect(filterAtoms([atom], { text: 'missing' }, protocols)).toHaveLength(0);
    });

    it('should aggregate AND filters across multiple protocols', () => {
        const atom = makeAtom({});
        atom.protocols.set('mock', makeStubProtocolState({ trailers: { 'Confidence': ['high'] } }));
        atom.protocols.set('fred', makeStubProtocolState({ trailers: { 'Team': ['alpha'] } }));

        // Match: Both true
        expect(filterAtoms([atom], { 
            filters: resolveFilters({ 'confidence': 'high', 'fred/team': 'alpha' }, protocols) 
        }, protocols)).toHaveLength(1);

        // Mismatch: One false
        expect(filterAtoms([atom], { 
            filters: resolveFilters({ 'confidence': 'low', 'fred/team': 'alpha' }, protocols) 
        }, protocols)).toHaveLength(0);
    });

    it('should evaluate qualified namespace paths correctly', () => {
        const atom = makeAtom({});
        atom.protocols.set('fred', makeStubProtocolState({ trailers: { 'Team': ['alpha'] } }));
  
        const results = filterAtoms([atom], {
            filters: resolveFilters({ 'fred/team': 'alpha' }, protocols)
        }, protocols);
        expect(results).toHaveLength(1);
    });
  });
});