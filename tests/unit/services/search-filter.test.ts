import { describe, it, expect, beforeEach } from 'vitest';
import { SearchFilter } from '../../../src/services/search-filter.js';
import { ProtocolRegistry } from '../../../src/services/protocol-registry.js';
import { Protocol } from '../../../src/services/protocol.js';
import { LoreProtocolDefinition } from '../../../src/protocols/lore.js';
import { DEFAULT_CONFIG } from '../../../src/util/constants.js';
import type { Atom } from '../../../src/types/domain.js';

describe('SearchFilter', () => {
  let filter: SearchFilter;
  let registry: ProtocolRegistry;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    const lore = new Protocol(LoreProtocolDefinition, DEFAULT_CONFIG);
    registry.register(lore);
    filter = new SearchFilter(registry);
  });

  const mockAtoms: Atom[] = [
    {
      id: 'abc12345',
      commitHash: 'h1',
      date: new Date('2026-05-01T12:00:00Z'),
      author: 'cole@example.com',
      intent: 'feat(auth): valid login',
      body: 'Body text here',
      protocols: new Map([
        ['lore', { 
          name: 'Lore', 
          version: '1.0', 
          identityKey: 'Lore-id', 
          trailers: {
            'Lore-id': ['abc12345'],
            Confidence: ['high'],
            'Scope-risk': ['narrow'],
            Reversibility: ['clean'],
            Constraint: ['c1'],
          } 
        }]
      ]),
      filesChanged: ['f1.ts'],
    } as any,
    {
      id: 'def67890',
      commitHash: 'h2',
      date: new Date('2026-05-10T12:00:00Z'),
      author: 'ivan@example.com',
      intent: 'fix(ui): layout bug',
      body: 'Body text here',
      protocols: new Map([
        ['lore', { 
          name: 'Lore', 
          version: '1.0', 
          identityKey: 'Lore-id', 
          trailers: {
            'Lore-id': ['def67890'],
            Confidence: ['low'],
            'Scope-risk': ['wide'],
            Reversibility: ['migration-needed'],
            Rejected: ['r1'],
          } 
        }]
      ]),
      filesChanged: ['f2.ts'],
    } as any,
  ];

  it('should filter by scope', () => {
    const results = filter.applyFilters(mockAtoms, { scope: 'auth' } as any);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('abc12345');
  });

  it('should filter by author', () => {
    const results = filter.applyFilters(mockAtoms, { author: 'ivan' } as any);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('def67890');
  });

  it('should filter by date range (since)', () => {
    const results = filter.applyFilters(mockAtoms, { 
      sinceDate: new Date('2026-05-05'),
    } as any);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('def67890');
  });

  it('should filter by trailer presence (has)', () => {
    const results = filter.applyFilters(mockAtoms, { has: 'Constraint' } as any);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('abc12345');
  });

  it('should filter by confidence', () => {
    const results = filter.applyFilters(mockAtoms, { 
      filters: { confidence: 'high' } 
    } as any);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('abc12345');
  });

  it('should filter by full-text search', () => {
    const results = filter.applyFilters(mockAtoms, { text: 'layout' } as any);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('def67890');
  });

  describe('Backward Compatibility (Legacy Fallback)', () => {
    it('should correctly filter atoms that lack a protocols map using root trailers', () => {
      const legacyAtom: any = {
        id: 'legacy123',
        trailers: { Confidence: ['high'] },
        intent: 'legacy commit',
        body: '',
        date: new Date(),
        protocols: new Map()
      };
      
      // Filter by confidence (should use fallback logic)
      const results = filter.applyFilters([legacyAtom], { 
        filters: { confidence: 'high' } 
      } as any);
      
      expect(results).toHaveLength(1);
    });
  });

  describe('Multi-Protocol Semantic Search', () => {
    it('should match if a text query is found in a secondary protocol state', () => {
      const multiAtom: any = {
        id: 'id123',
        intent: 'subject',
        body: 'body',
        date: new Date(),
        protocols: new Map([
          ['lore', { name: 'Lore', trailers: {} }],
          ['fred', { name: 'Fred', trailers: { 'Fred-Notes': ['found me'] } }]
        ])
      };
      
      const results = filter.applyFilters([multiAtom], { text: 'found me' } as any);
      expect(results).toHaveLength(1);
    });

    it('should match if any protocol in the atom matches generic filters', () => {
      const multiAtom: any = {
        id: 'id123',
        intent: 'subject',
        body: 'body',
        date: new Date(),
        protocols: new Map([
          ['lore', { name: 'Lore', trailers: { Confidence: ['medium'] } }],
          ['fred', { name: 'Fred', trailers: { 'Fred-Level': ['high'] } }]
        ])
      };
      
      // Register Fred protocol so filter knows about it
      const fred: any = {
        name: 'Fred',
        namespace: 'Fred',
        matches: (state: any, filters: any) => {
          if (filters['Fred-Level']) return state.trailers['Fred-Level'][0] === filters['Fred-Level'];
          return true;
        },
        authorize: (key: string) => key === 'Fred-Level' ? 'Fred-Level' : null,
      } as any;
      registry.register(fred);

      // Search by Fred-Level
      const results = filter.applyFilters([multiAtom], { 
        filters: { 'Fred-Level': 'high' } 
      } as any);
      
      expect(results).toHaveLength(1);
    });
  });
});
