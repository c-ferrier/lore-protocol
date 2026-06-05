import { filterAtoms, resolveFilterStrings, resolveFilters } from '../../../../src/engine/core/logic/filtering.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { makeAtom, makeMockContext } from '../../../../src/engine/testing.js';
import { ProtocolMap } from '../../../../src/engine/core/types/domain.js';

import { describe, it, expect, beforeEach } from 'vitest';

describe('Filtering Logic (Pure Functions)', () => {
  let registry: ProtocolRegistry;
  
  beforeEach(() => {
    registry = new ProtocolRegistry();
    
    // P1: Root protocol
    const protocol = makeMockContext({
        name: 'mock',
        namespace: '',
        trailers: {
            'Mock-id': { description: 'ID' },
            'Confidence': { description: 'C' }
        }
    });
    registry.register(protocol);

    // P2: Namespaced protocol
    const fredProtocol = makeMockContext({
        name: 'fred',
        namespace: 'fred',
        trailers: {
            'Fred-id': { description: 'ID' },
            'Team': { description: 'T' }
        }
    });
    registry.register(fredProtocol);
  });

  describe('resolveFilters', () => {
    it('should resolve simple key=value pairs', () => {
      const raw = { confidence: 'high' };
      const filters = resolveFilters(raw, registry);
      expect(filters).toEqual([
        { protocol: 'mock', key: 'confidence', op: 'eq', value: 'high' }
      ]);
    });

    it('should ignore null/undefined values', () => {
      const raw = { confidence: 'high', 'fred-id': null, team: undefined };
      const filters = resolveFilters(raw, registry);
      expect(filters).toEqual([
        { protocol: 'mock', key: 'confidence', op: 'eq', value: 'high' }
      ]);
    });

    it('should support array values as exact matches', () => {
      const raw = { confidence: ['high', 'medium'] };
      const filters = resolveFilters(raw, registry);
      expect(filters).toEqual([
        { protocol: 'mock', key: 'confidence', op: 'eq', value: ['high', 'medium'] }
      ]);
    });

    it('should route namespaced keys to the correct protocol', () => {
      const raw = { 'fred/team': 'alpha' };
      const filters = resolveFilters(raw, registry);
      expect(filters).toEqual([
        { protocol: 'fred', key: 'team', op: 'eq', value: 'alpha' }
      ]);
    });

    it('should resolve un-prefixed keys by querying the registry', () => {
      const raw = { team: 'alpha' };
      const filters = resolveFilters(raw, registry);
      expect(filters).toEqual([
        { protocol: 'fred', key: 'team', op: 'eq', value: 'alpha' }
      ]);
    });

    it('should support explicit operators (e.g. key:has)', () => {
      const raw = { 'confidence:has': 'true' };
      const filters = resolveFilters(raw, registry);
      expect(filters).toEqual([
        { protocol: 'mock', key: 'confidence', op: 'has', value: 'true' }
      ]);
    });

    it('should fall back to "eq" if the operator is invalid/unsupported', () => {
      const raw = { 'confidence:foo': 'high' };
      const filters = resolveFilters(raw, registry);
      expect(filters).toEqual([
        { protocol: 'mock', key: 'confidence', op: 'eq', value: 'high' }
      ]);
    });
  });

  describe('resolveFilterStrings', () => {
    it('should parse key=value strings into filters', () => {
      const strings = ['confidence=high', 'fred/team=alpha'];
      const filters = resolveFilterStrings(strings, registry);
      expect(filters).toEqual([
        { protocol: 'mock', key: 'confidence', op: 'eq', value: 'high' },
        { protocol: 'fred', key: 'team', op: 'eq', value: 'alpha' }
      ]);
    });

    it('should parse strings without = as existence checks (:has)', () => {
      const strings = ['confidence'];
      const filters = resolveFilterStrings(strings, registry);
      expect(filters).toEqual([
        { protocol: 'mock', key: 'confidence', op: 'has', value: 'true' }
      ]);
    });
  });

  describe('filterAtoms', () => {
    it('should return empty if atom does not match simple trailer filter', () => {
      const atom = makeAtom({ trailers: { 'Mock-id': ['a1'], Confidence: ['low'] } });
      const results = filterAtoms([atom], {
          filters: resolveFilters({ confidence: 'high' }, registry)
      }, registry);
      expect(results).toHaveLength(0);
    });

    it('should return atom if it matches simple trailer filter', () => {
      const atom = makeAtom({ trailers: { 'Mock-id': ['a1'], Confidence: ['high'] } });
      const results = filterAtoms([atom], {
          filters: resolveFilters({ confidence: 'high' }, registry)
      }, registry);
      expect(results).toHaveLength(1);
    });

    it('should match multiple values if array is provided', () => {
      const atom = makeAtom({ trailers: { 'Mock-id': ['a1'], Confidence: ['high'] } });
      const results = filterAtoms([atom], {
          filters: resolveFilters({ confidence: ['medium', 'high'] }, registry)
      }, registry);
      expect(results).toHaveLength(1);
    });

    it('should fail if any filter in an AND set fails', () => {
      const atom = makeAtom({ trailers: { 'Mock-id': ['a1'], Confidence: ['high'] } });
      const results = filterAtoms([atom], {
          filters: resolveFilters({ confidence: 'high', 'fred/team': 'alpha' }, registry) // Missing fred protocol
      }, registry);
      expect(results).toHaveLength(0);
    });

    it('should match --has option across any protocol', () => {
      const atom = makeAtom({ trailers: { Confidence: ['high'] } });
      const results = filterAtoms([atom], { has: 'Confidence' }, registry);
      expect(results).toHaveLength(1);

      const resultsMiss = filterAtoms([atom], { has: 'Missing' }, registry);
      expect(resultsMiss).toHaveLength(0);
    });

    it('should filter by author', () => {
      const atom = makeAtom({});
      atom.author = 'Alice';
      
      expect(filterAtoms([atom], { author: 'alice' }, registry)).toHaveLength(1);
      expect(filterAtoms([atom], { author: 'bob' }, registry)).toHaveLength(0);
    });

    it('should filter by scope name (conventional commit)', () => {
      const atom = makeAtom({ subject: 'feat(ui): add button' });
      expect(filterAtoms([atom], { scope: 'ui' }, registry)).toHaveLength(1);
      expect(filterAtoms([atom], { scope: 'auth' }, registry)).toHaveLength(0);
    });

    it('should support regex scope matching (Repository Pushdown Parity)', () => {
        const atom = makeAtom({ subject: 'feat(auth): login' });
        // The repository generates this pattern for 'auth' scope
        const pattern = '^[a-zA-Z]+\\(auth\\):';
        expect(filterAtoms([atom], { scope: pattern }, registry)).toHaveLength(1);
    });

    it('should handle regex escaping in scope matching', () => {
        const atom = makeAtom({ subject: 'feat(auth): login' });
        const malicious = 'auth) | grep (';
        // Should handle gracefully (no match but no crash)
        expect(filterAtoms([atom], { scope: malicious }, registry)).toHaveLength(0);
    });

    it('should filter by dates', () => {
      const atom = makeAtom({});
      atom.date = new Date('2023-05-15T00:00:00Z');
      
      expect(filterAtoms([atom], { sinceDate: new Date('2023-05-14T00:00:00Z') }, registry)).toHaveLength(1);
      expect(filterAtoms([atom], { sinceDate: new Date('2023-05-16T00:00:00Z') }, registry)).toHaveLength(0);
      
      expect(filterAtoms([atom], { untilDate: new Date('2023-05-16T00:00:00Z') }, registry)).toHaveLength(1);
      expect(filterAtoms([atom], { untilDate: new Date('2023-05-14T00:00:00Z') }, registry)).toHaveLength(0);
    });

    it('should search across ALL trailers for --text query', () => {
        const atom = makeAtom({});
        atom.subject = 'fix: bug';
        atom.body = 'Detailed notes.';
        atom.protocols.set('mock', { trailers: { 'Confidence': ['low'] }, unauthorized: {} });
        atom.protocols.set('fred', { trailers: { 'Team': ['backend'] }, unauthorized: {} });

        expect(filterAtoms([atom], { text: 'bug' }, registry)).toHaveLength(1);
        expect(filterAtoms([atom], { text: 'notes' }, registry)).toHaveLength(1);
        expect(filterAtoms([atom], { text: 'low' }, registry)).toHaveLength(1);
        expect(filterAtoms([atom], { text: 'backend' }, registry)).toHaveLength(1);
        expect(filterAtoms([atom], { text: 'missing' }, registry)).toHaveLength(0);
    });

    it('should aggregate AND filters across multiple protocols', () => {
        const atom = makeAtom({});
        atom.protocols.set('mock', { trailers: { 'Confidence': ['high'] }, unauthorized: {} });
        atom.protocols.set('fred', { trailers: { 'Team': ['alpha'] }, unauthorized: {} });

        // Match: Both true
        expect(filterAtoms([atom], { 
            filters: resolveFilters({ 'confidence': 'high', 'fred/team': 'alpha' }, registry) 
        }, registry)).toHaveLength(1);

        // Mismatch: One false
        expect(filterAtoms([atom], { 
            filters: resolveFilters({ 'confidence': 'low', 'fred/team': 'alpha' }, registry) 
        }, registry)).toHaveLength(0);
    });

    it('should evaluate qualified namespace paths correctly', () => {
        const atom = makeAtom({});
        atom.protocols.set('fred', { trailers: { 'Team': ['alpha'] }, unauthorized: {} });
  
        const results = filterAtoms([atom], {
            filters: resolveFilters({ 'fred/team': 'alpha' }, registry)
        }, registry);
        expect(results).toHaveLength(1);
    });
  });
});
