import { describe, expect,it } from 'vitest';

import { extractReferenceIds, hydrateAtoms } from '../../../../src/engine/core/logic/hydration.js';
import { makeAtom, makeRawCommit,makeStubProtocolContext, makeStubProtocolMap, makeStubProtocolState,TEST_PROTOCOL_DEFINITION } from '../../../../src/engine/testing.js';

describe('Hydration Logic (Pure Functions)', () => {
  const protocol = makeStubProtocolContext({
    name: 'test',
    version: '1.0',
    identityKey: 'Id',
    namespace: '',
    trailers: {
      'Id': { description: 'ID', multivalue: false, validation: 'none' as const },
      'Key': { description: 'Key', multivalue: false, validation: 'none' as const }
    }
  });

  const protocols = makeStubProtocolMap([protocol]);

  describe('hydrateAtoms (Trailer Stripping)', () => {
    const hydrate = (body: string, trailers: string, localProtocols = protocols) => {
        const raw = makeRawCommit({
            subject: 'Subject',
            body,
            trailers,
            id: '12345678'
        });
        return hydrateAtoms([raw], localProtocols)[0];
    };

    it('should strip trailers with varying whitespace', () => {
      const trailers = 'Id: 12345678\nKey: value';
      const body = 'Actual message.\n\n   Id: 12345678  \n Key: value \n\n';
      expect(hydrate(body, trailers).body).toBe('Actual message.');
    });

    it('should respect implicit ownership (protocols get what they define, permissive gets orphans)', () => {
      const p1 = makeStubProtocolContext({ 
        name: 'p1', 
        namespace: 'p1',
        identityKey: 'P1-id',
        trailers: { 
          'P1-id': { description: 'ID', multivalue: false, validation: 'none' as const }, 
          'Authorized': { description: 'Auth', multivalue: false, validation: 'none' as const } 
        } 
      });
      
      const p2 = makeStubProtocolContext({ 
        name: 'p2', 
        namespace: '', // Root (permissive)
        permissive: true,
        identityKey: 'P2-id',
        trailers: { 
          'P2-id': { description: 'ID', multivalue: false, validation: 'none' as const } 
        }
      });

      const localProtocols = makeStubProtocolMap([p1, p2]);

      const raw = makeRawCommit({
        trailers: 'p1: P1-id: 1\np1: Authorized: val\nOrphan: stray\nP2-id: 2'
      });

      const [atom] = hydrateAtoms([raw], localProtocols);
      
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
        const p2 = makeStubProtocolContext({ name: 'fred', namespace: 'fred', identityKey: 'Fred-id' });
        const localProtocols = makeStubProtocolMap([protocol, p2]);
        const trailers = 'Id: 12345678\nfred: Fred-id: abcdefgh';
        const body = 'Message.\n\nId: 12345678\nfred: Fred-id: abcdefgh';
        const raw = makeRawCommit({ trailers, body });
        const atom = hydrateAtoms([raw], localProtocols)[0];
        expect(atom.body).toBe('Message.');
    });
  });

  describe('extractReferenceIds', () => {
      it('should extract unique identities from atom protocol state', () => {
          const mockProtocol = makeStubProtocolContext({
              trailers: {
                  ...TEST_PROTOCOL_DEFINITION.trailers,
                  'Related': { description: 'R', multivalue: true, validation: 'reference' as const, isCore: true }
              }
          }); 
          const localProtocols = makeStubProtocolMap([mockProtocol]);

          const atom = makeAtom({
              protocols: makeStubProtocolMap([['mock', makeStubProtocolState({ 
                  trailers: {
                      'Mock-id': ['aaaa1111'],
                      'Related': ['aaaa2222', 'aaaa3333']
                  }
              })]])
          });
          const ids = extractReferenceIds([atom], localProtocols);
          expect(ids).toHaveLength(2);
          expect(ids.map(i => i.id)).toContain('aaaa2222');
          expect(ids.map(i => i.id)).toContain('aaaa3333');
      });

      it('should handle qualified references (protocol/id)', () => {
          const p1 = makeStubProtocolContext({ 
              name: 'p1', 
              namespace: 'p1', 
              identityKey: 'id', 
              trailers: { 
                  'Ref': { description: 'R', multivalue: true, validation: 'reference' as const } 
              } 
          });
          const p2 = makeStubProtocolContext({ name: 'p2', namespace: 'p2', identityKey: 'id' });
          const localProtocols = makeStubProtocolMap([p1, p2]);

          const atom = makeAtom({
              protocols: makeStubProtocolMap([['p1', makeStubProtocolState({ trailers: { 'Ref': ['p2/target'] } })]])
          });

          const ids = extractReferenceIds([atom], localProtocols);
          expect(ids[0]).toEqual({ protocol: 'p2', id: 'target' });
      });

      it('should deduplicate references across multiple atoms', () => {
          const p1 = makeStubProtocolContext({ 
              name: 'p1', 
              identityKey: 'id', 
              trailers: { 
                  'Ref': { description: 'R', multivalue: true, validation: 'reference' as const } 
              } 
          });
          const localProtocols = makeStubProtocolMap([p1]);

          const a1 = makeAtom({ protocols: makeStubProtocolMap([['p1', makeStubProtocolState({ trailers: { 'Ref': ['shared'] } })]]) });
          const a2 = makeAtom({ protocols: makeStubProtocolMap([['p1', makeStubProtocolState({ trailers: { 'Ref': ['shared'] } })]]) });

          const ids = extractReferenceIds([a1, a2], localProtocols);
          expect(ids).toHaveLength(1);
          expect(ids[0].id).toBe('shared');
      });
  });

  it('should hydrate multiple commits into Atoms', () => {
    const p1 = makeStubProtocolContext(TEST_PROTOCOL_DEFINITION);
    const localProtocols = makeStubProtocolMap([p1]);

    const c1 = makeRawCommit({ hash: 'h1', trailers: 'Mock-id: a1b2c3d4' });
    const c2 = makeRawCommit({ hash: 'h2', trailers: 'Mock-id: e5f6a7b8' });
    
    const results = hydrateAtoms([c1, c2], localProtocols);
    expect(results).toHaveLength(2);
    expect(results[0].commitHash).toBe('h1');
    expect(results[1].commitHash).toBe('h2');
  });
});