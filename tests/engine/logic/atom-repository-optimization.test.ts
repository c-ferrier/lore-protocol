import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { makeAtom, makeProtocol, makeProtocolRegistry, makeRawCommit } from '../../../src/engine/testing.js';
import { makeAtomRepository, makeMockGitClient, makeMockQueryCache } from '../engine-test-utils.js';

import { describe, it, expect, vi, beforeEach } from 'vitest';
;

describe('AtomRepository Performance Optimizations', () => {
  let repo: any;
  let gitClient: any;
  let cache: any;
  let registry: any;

  beforeEach(() => {
    registry = makeProtocolRegistry([
      makeProtocol({ name: 'mock', identityKey: 'Mock-id', permissive: true, namespace: '' }),
      makeProtocol({ name: 'fred', identityKey: 'Fred-id', permissive: true, namespace: 'fred' })
    ]);
    gitClient = makeMockGitClient();
    cache = makeMockQueryCache();
    repo = makeAtomRepository({ registry, gitClient, cache });
  });

  describe('Atomic Identity Caching (Partial Hits)', () => {
    it('should resolve from cache where possible and batch only misses to Git', async () => {
      const headHash = 'f1e2d3c4b5a6';
      vi.mocked(gitClient.resolveRef).mockResolvedValue(headHash);
      
      const id1 = '11111111'; // In cache
      const id2 = '22222222'; // Missing
      
      const commit1 = makeRawCommit({ hash: 'hash1', id: id1 });
      const commit2 = makeRawCommit({ hash: 'hash2', id: id2 });

      // Mock Cache: id1 exists, id2 is missing
      vi.spyOn(cache, 'get').mockImplementation(async (head: string, fingerprint: string) => {
        if (fingerprint === `identity:mock/${id1}`) return ['hash1'];
        return null;
      });

      vi.mocked(gitClient.getCommitsByHashes).mockImplementation(async (hashes: string[]) => {
        const out = [];
        if (hashes.includes('hash1')) out.push(commit1);
        if (hashes.includes('hash2')) out.push(commit2);
        return out;
      });
      vi.mocked(gitClient.query).mockResolvedValue([commit2]);

      // Specify protocol to avoid pattern bloat from registry.getAll()
      const results = await repo.findByIds([{ id: id1, protocol: 'mock' }, { id: id2, protocol: 'mock' }]);

      expect(results).toHaveLength(2);
      
      // Verification: Git Query should ONLY contain the missing ID pattern
      const queryCall = vi.mocked(gitClient.query).mock.calls[0][0];
      expect(queryCall.regexPatterns[0]).toHaveLength(1);
      expect(queryCall.regexPatterns[0][0]).toContain(id2);
      expect(queryCall.regexPatterns[0][0]).not.toContain(id1);
    });
  });

  describe('In-Memory Short-Circuit (Hash Links)', () => {
    it('should resolve direct hash links without reaching out to Git', async () => {
      const id1 = '11111111';
      const hash2 = '2222222222222222222222222222222222222222';
      
      const atom1 = makeAtom({ 
        hash: 'h1', 
        id: id1, 
        trailers: { 'Mock-id': [id1], 'Related': [hash2] } 
      });
      
      const atom2 = makeAtom({ 
        hash: hash2, 
        id: '22222222',
        trailers: { 'Mock-id': ['22222222'] }
      });

      // Discovery: returns both atoms
      vi.mocked(gitClient.query).mockResolvedValue([
          makeRawCommit({ hash: 'h1', id: id1 }),
          makeRawCommit({ hash: hash2, id: '22222222' })
      ]);
      
      const initial = await repo.find();
      expect(gitClient.query).toHaveBeenCalledTimes(1);

      // Expansion: should find atom2 in memory by its hash
      vi.mocked(gitClient.query).mockClear();
      const expanded = await repo.resolveFollowLinks(initial, 1);

      // Verification: No second git query should have happened
      expect(gitClient.query).not.toHaveBeenCalled();
      expect(expanded).toHaveLength(2);
    });
  });

  describe('Naked ID Ambiguity Protection', () => {
    it('should only support naked ID lookups for the Root protocol', async () => {
      const atom = makeAtom({ id: 'shared-id' });
      // Root protocol is 'mock' (lowercase in our registry setup)
      const mockState = { trailers: { 'Mock-id': ['shared-id'] } };
      const fredState = { trailers: { 'Fred-id': ['shared-id'] } };
      atom.protocols.set('mock', mockState as any);
      atom.protocols.set('fred', fredState as any);

      vi.mocked(gitClient.query).mockClear();
      
      const ghostAtom = makeAtom({ id: 'ghost' });
      const ghostMockState = ghostAtom.protocols.get('mock') || { trailers: {}, unauthorized: {} };
      ghostMockState.trailers['Related'] = ['shared-id'];
      ghostAtom.protocols.set('mock', ghostMockState as any);
      
      await repo.resolveFollowLinks([ghostAtom, atom], 1);
      
      // If short-circuit works for root protocol, no query is made
      expect(gitClient.query).not.toHaveBeenCalled();
    });
  });
});