import { describe, it, expect, beforeEach } from 'vitest';
import { SearchFilter } from '../../../../src/engine/services/search-filter.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG } from '../test-utils.js';
import type { Atom } from '../../../../src/engine/types/domain.js';

describe('SearchFilter', () => {
  let filter: SearchFilter;
  let registry: ProtocolRegistry;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    const mock = new Protocol(MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG);
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
      filters: { confidence: 'high' } 
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
      const multiAtom: any = {
        id: 'id123',
        subject: 'subject',
        body: 'body',
        date: new Date(),
        protocols: new Map([
          ['mock', { name: 'Mock', trailers: { Confidence: ['medium'] } }],
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
      const results = filter.filter([multiAtom], { 
        filters: { 'Fred-Level': 'high' } 
      } as any);
      
      expect(results).toHaveLength(1);
    });
  });
});
