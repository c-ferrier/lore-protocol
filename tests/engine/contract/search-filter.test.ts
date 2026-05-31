import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SearchFilter } from '../../../src/engine/services/search-filter.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { TEST_PROTOCOL_DEFINITION, makeAtomRepository, TEST_ENGINE_CONFIG, makeProtocol, makeMockProtocol } from '../engine-test-utils.js';
import type { Atom } from '../../../src/engine/types/domain.js';
import { FilterResolver } from '../../../src/engine/services/filter-resolver.js';

describe('SearchFilter', () => {
  let filter: SearchFilter;
  let registry: ProtocolRegistry;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    const mock = makeProtocol(TEST_PROTOCOL_DEFINITION, {
        strict: true,
        permissive: false
    } as any);
    registry.register(mock);
    filter = new SearchFilter(registry);
  });

  const mockAtoms: Atom[] = [
    {
      commitHash: 'h1',
      date: new Date('2026-05-01T12:00:00Z'),
      author: 'cole@example.com',
      subject: 'feat(auth): valid login',
      body: 'Body text here',
      protocols: new Map([
        ['mock', { 
          name: 'Mock', 
          version: '1.0', 
          identityKey: 'Mock-id', 
          trailers: {
            'Mock-id': ['abc12345'],
            Confidence: ['high'],
            Constraint: ['c1'],
          } 
        }]
      ]),
      filesChanged: ['f1.ts'],
    },
    {
      commitHash: 'h2',
      date: new Date('2026-05-10T12:00:00Z'),
      author: 'ivan@example.com',
      subject: 'fix(ui): layout bug',
      body: 'Body text here',
      protocols: new Map([
        ['mock', { 
          name: 'Mock', 
          version: '1.0', 
          identityKey: 'Mock-id', 
          trailers: {
            'Mock-id': ['def67890'],
            Confidence: ['low'],
            Rejected: ['r1'],
          } 
        }]
      ]),
      filesChanged: ['f2.ts'],
    },
  ];

  it('should filter by scope', () => {
    const results = filter.filter(mockAtoms, { scope: 'auth' } as any);
    expect(results).toHaveLength(1);
    expect(results[0].commitHash).toBe('h1');
  });

  it('should filter by author', () => {
    const results = filter.filter(mockAtoms, { author: 'ivan' } as any);
    expect(results).toHaveLength(1);
    expect(results[0].commitHash).toBe('h2');
  });

  it('should filter by date range (since)', () => {
    const results = filter.filter(mockAtoms, { 
      sinceDate: new Date('2026-05-05'),
    } as any);
    expect(results).toHaveLength(1);
    expect(results[0].commitHash).toBe('h2');
  });

  it('should filter by trailer presence (has)', () => {
    const results = filter.filter(mockAtoms, { has: 'Constraint' } as any);
    expect(results).toHaveLength(1);
    expect(results[0].commitHash).toBe('h1');
  });

  it('should filter by confidence', () => {
    const results = filter.filter(mockAtoms, { 
      filters: FilterResolver.resolve({ confidence: 'high' }, registry)
    } as any);
    expect(results).toHaveLength(1);
    expect(results[0].commitHash).toBe('h1');
  });

  it('should filter by full-text search', () => {
    const results = filter.filter(mockAtoms, { text: 'layout' } as any);
    expect(results).toHaveLength(1);
    expect(results[0].commitHash).toBe('h2');
  });

  describe('Multi-Protocol Semantic Search', () => {
    it('should match if a text query is found in a secondary protocol state', () => {
      const multiAtom: any = {
        id: 'id123',
        subject: 'subject',
        body: 'body',
        date: new Date(),
        protocols: new Map([
          ['mock', { name: 'Mock', trailers: {} }],
          ['fred', { name: 'Fred', trailers: { 'Fred-Notes': ['found me'] } }]
        ])
      };
      
      const results = filter.filter([multiAtom], { text: 'found me' } as any);
      expect(results).toHaveLength(1);
    });

    it('should match if any protocol in the atom matches generic filters', () => {
      // Register Fred protocol with a UNIQUE key (not shared with Mock)
      const fred = makeMockProtocol({
        name: 'Fred',
        namespace: 'Fred',
        owns: (key: string) => key === 'Fred-Internal',
        matches: (state: any, filters: any) => {
          const filter = filters[0];
          if (filter && filter.key === 'Fred-Internal') return state.trailers['Fred-Internal'][0] === filter.value;
          return true;
        },
        authorize: (key: string) => key === 'Fred-Internal' ? 'Fred-Internal' : null,
      });
      registry.register(fred);

      const multiAtom: any = {
        protocols: new Map([
          ['mock', { name: 'Mock', trailers: {} }],
          ['fred', { name: 'Fred', trailers: { 'Fred-Internal': ['secret'] } }]
        ])
      };

      // Search by Fred-Internal (unqualified - should work because it's unique)
      const results = filter.filter([multiAtom], { 
        filters: FilterResolver.resolve({ 'Fred-Internal': 'secret' }, registry)
      } as any);

      expect(results).toHaveLength(1);
    });

  });
});
