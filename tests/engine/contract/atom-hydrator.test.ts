import { describe, it, expect } from 'vitest';
import { hydrateAtoms, extractReferenceIds } from '../../../src/engine/logic/hydration.js';
import { 
  makeRawCommit, 
  makeProtocol, 
  makeProtocolRegistry,
  TEST_ID_KEY
} from '../engine-test-utils.js';
import type { RawCommit } from '../../../src/engine/interfaces/git-client.js';

describe('AtomHydrator Contract (Logic)', () => {
  const protocol = makeProtocol();
  const registry = makeProtocolRegistry([protocol]);

  describe('hydrateAtoms', () => {
    it('should hydrate raw commits into Atoms using the built-in file list', () => {
      const mockCommit: RawCommit = makeRawCommit({ 
          hash: 'abc12345', 
          id: 'a1b2c3d4',
          filesChanged: ['src/main.ts']
      });
      
      const result = hydrateAtoms([mockCommit], registry);

      expect(result).toHaveLength(1);
      const atom = result[0];
      expect(atom.commitHash).toBe(mockCommit.hash);
      expect(atom.protocols.get('mock')?.trailers[TEST_ID_KEY]).toEqual(['a1b2c3d4']);
      expect(atom.filesChanged).toEqual(['src/main.ts']);
    });

    it('should respect implicit ownership (protocols get what they define, permissive gets orphans)', () => {
      const p1 = makeProtocol({ 
        name: 'p1', 
        identityKey: 'P1-id',
        trailers: { 'P1-id': { description: 'ID' }, 'Authorized': { description: 'Auth' } } 
      }, { permissive: false });
      
      const p2 = makeProtocol({ 
        name: 'p2', 
        permissive: true,
        identityKey: 'P2-id',
        trailers: { 'P2-id': { description: 'ID' } }
      });

      const localRegistry = makeProtocolRegistry([p1, p2]);

      const raw: RawCommit = makeRawCommit({
        trailers: 'P1-id: 1\nAuthorized: val\nOrphan: stray\nP2-id: 2',
        filesChanged: ['src/main.ts']
      });

      const [atom] = hydrateAtoms([raw], localRegistry);
      
      const state1 = atom.protocols.get('p1');
      const state2 = atom.protocols.get('p2');

      expect(state1?.trailers.Authorized).toEqual(['val']);
      expect(state2?.trailers.Orphan).toEqual(['stray']); // Orphan went to permissive protocol
    });

    it('should strip trailers from body when body is exactly the trailer block', () => {
        const trailers = 'Mock-id: a1b2c3d4\nConfidence: high';
        const raw = makeRawCommit({
            subject: 'feat: test',
            body: trailers,
            trailers,
            filesChanged: []
        });

        const [atom] = hydrateAtoms([raw], registry);
        expect(atom.body).toBe('');
    });
  });

  describe('extractReferenceIds', () => {
    it('should extract all unique reference identities from a set of atoms', () => {
      const p = makeProtocol({
          name: 'mock',
          trailers: {
              'Related': { description: 'ref', validation: 'reference' }
          }
      });
      const localRegistry = makeProtocolRegistry([p]);

      const commits = [
        makeRawCommit({ hash: 'h1', id: 'a1', trailers: 'Mock-id: a1\nRelated: b1', filesChanged: [] }),
        makeRawCommit({ hash: 'h2', id: 'a2', trailers: 'Mock-id: a2\nRelated: b1\nRelated: c1', filesChanged: [] })
      ];

      const atoms = hydrateAtoms(commits, localRegistry);
      const refs = extractReferenceIds(atoms, localRegistry);

      expect(refs).toHaveLength(2);
      expect(refs.map(r => r.id)).toContain('b1');
      expect(refs.map(r => r.id)).toContain('c1');
    });
  });
});
