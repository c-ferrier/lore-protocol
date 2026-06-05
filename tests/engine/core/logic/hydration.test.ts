import { extractReferenceIds, hydrateAtoms } from '../../../..//src/engine/core/logic/hydration.js';
import { TEST_PROTOCOL_DEFINITION, makeAtom, makeMockContext, makeProtocolRegistry, makeRawCommit } from '../../../..//src/engine/testing.js';

import { describe, it, expect } from 'vitest';

describe('Hydration Logic (Pure Functions)', () => {
  const protocol = makeMockContext({
    name: 'test',
    version: '1.0',
    identityKey: 'Id',
    namespace: '',
    trailers: {
      'Id': { description: 'ID', multivalue: false, validation: 'none' as const },
      'Key': { description: 'Key', multivalue: false, validation: 'none' as const }
    }
  });

  const registry = makeProtocolRegistry([protocol as any]);

  describe('hydrateAtoms (Trailer Stripping)', () => {
    const hydrate = (body: string, trailers: string) => {
        const raw = makeRawCommit({
            subject: 'Subject',
            body,
            trailers,
            id: '12345678'
        });
        return hydrateAtoms([raw], registry)[0];
    };

    it('should strip trailers with varying whitespace', () => {
      const trailers = 'Id: 12345678\nKey: value';
      const body = 'Actual message.\n\n   Id: 12345678  \n Key: value \n\n';
      expect(hydrate(body, trailers).body).toBe('Actual message.');
    });

    it('should respect implicit ownership (protocols get what they define, permissive gets orphans)', () => {
      const p1 = makeMockContext({ 
        name: 'p1', 
        namespace: 'p1',
        identityKey: 'P1-id',
        trailers: { 'P1-id': { description: 'ID' }, 'Authorized': { description: 'Auth' } } 
      });
      
      const p2 = makeMockContext({ 
        name: 'p2', 
        namespace: '', // Root (permissive)
        permissive: true,
        identityKey: 'P2-id',
        trailers: { 'P2-id': { description: 'ID' } }
      });

      const localRegistry = makeProtocolRegistry([p1 as any, p2 as any]);

      const raw = makeRawCommit({
        trailers: 'p1: P1-id: 1\np1: Authorized: val\nOrphan: stray\nP2-id: 2'
      });

      const [atom] = hydrateAtoms([raw], localRegistry);
      
      const state1 = atom.protocols.get('p1');
      const state2 = atom.protocols.get('p2');

      expect(state1?.trailers.Authorized).toEqual(['val']);
      expect(state2?.trailers.Orphan).toEqual(['stray']); // Orphan went to root permissive protocol
    });

    it('should handle trailers indented with tabs', () => {
      const trailers = 'Id: 12345678\nKey: value';
      const body = 'Actual message.\n\n\tId: 12345678\n\tKey: value';
      expect(hydrate(body, trailers).body).toBe('Actual message.');
    });

    it('should NOT strip trailers if they appear in the middle of the body', () => {
      const trailers = 'Id: 12345678\nKey: value';
      const body = 'Message with Id: 12345678 inside it.\n\nMore text.';
      expect(hydrate(body, trailers).body).toBe(body.trim());
    });

    it('should handle multi-value trailers correctly', () => {
      const trailers = 'Id: 12345678\nKey: v1\nKey: v2';
      const body = 'Subject.\n\nId: 12345678\nKey: v1\nKey: v2';
      expect(hydrate(body, trailers).body).toBe('Subject.');
    });

    it('should return empty string if body is identical to trailers', () => {
      const trailers = 'Id: 12345678\nKey: val';
      const body = '  Id: 12345678\nKey: val  ';
      expect(hydrate(body, trailers).body).toBe('');
    });

    it('should handle multiple protocols in trailer block', () => {
        const p2 = makeMockContext({ name: 'fred', namespace: 'fred', identityKey: 'Fred-id' });
        const localRegistry = makeProtocolRegistry([protocol as any, p2 as any]);
        const trailers = 'Id: 12345678\nfred: Fred-id: abcdefgh';
        const body = 'Message.\n\nId: 12345678\nfred: Fred-id: abcdefgh';
        const raw = makeRawCommit({ trailers, body });
        const atom = hydrateAtoms([raw], localRegistry)[0];
        expect(atom.body).toBe('Message.');
    });
  });

  describe('extractReferenceIds', () => {
      it('should extract unique identities from atom protocol state', () => {
          const mockProtocol = makeMockContext({
              trailers: {
                  ...TEST_PROTOCOL_DEFINITION.trailers,
                  'Related': { description: 'R', validation: 'reference' } as any
              }
          }); 
          const localRegistry = makeProtocolRegistry([mockProtocol as any]);

          const atom = makeAtom({
              protocols: new Map([['mock', { 
                  trailers: {
                      'Mock-id': ['atom1'],
                      'Related': ['atom2', 'atom3']
                  },
                  unauthorized: {}
              }]])
          });
          const ids = extractReferenceIds([atom], localRegistry);
          expect(ids).toHaveLength(2);
          expect(ids.map(i => i.id)).toContain('atom2');
          expect(ids.map(i => i.id)).toContain('atom3');
      });

      it('should handle qualified references (protocol/id)', () => {
          const p1 = makeMockContext({ name: 'p1', namespace: 'p1', identityKey: 'id', trailers: { 'Ref': { validation: 'reference' } } as any });
          const p2 = makeMockContext({ name: 'p2', namespace: 'p2', identityKey: 'id' });
          const localRegistry = makeProtocolRegistry([p1 as any, p2 as any]);

          const atom = makeAtom({
              protocols: new Map([['p1', { trailers: { 'Ref': ['p2/target'] }, unauthorized: {} }]])
          });

          const ids = extractReferenceIds([atom], localRegistry);
          expect(ids[0]).toEqual({ protocol: 'p2', id: 'target' });
      });

      it('should deduplicate references across multiple atoms', () => {
          const p1 = makeMockContext({ name: 'p1', identityKey: 'id', trailers: { 'Ref': { validation: 'reference' } } as any });
          const localRegistry = makeProtocolRegistry([p1 as any]);

          const a1 = makeAtom({ protocols: new Map([['p1', { trailers: { 'Ref': ['shared'] }, unauthorized: {} }]]) });
          const a2 = makeAtom({ protocols: new Map([['p1', { trailers: { 'Ref': ['shared'] }, unauthorized: {} }]]) });

          const ids = extractReferenceIds([a1, a2], localRegistry);
          expect(ids).toHaveLength(1);
          expect(ids[0].id).toBe('shared');
      });
  });
});