import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomHydrator } from '../../../src/engine/services/atom-hydrator.ts';
import { makeAtomHydrator, makeRawCommit, makeMockGitClient, makeMockAtomCache, makeProtocolRegistry, makeProtocol } from '../engine-test-utils.js';
import type { RawCommit } from '../../../src/engine/interfaces/git-client.js';

const TEST_ID_KEY = "Mock-id";

describe('AtomHydrator Contract', () => {
  let gitClient: any;
  let hydrator: AtomHydrator;
  let atomCache: any;

  beforeEach(() => {
    gitClient = makeMockGitClient();
    atomCache = makeMockAtomCache();
    hydrator = makeAtomHydrator({
        gitClient,
        atomCache
    });
  });

  describe('hydrate', () => {
    const mockCommit: RawCommit = makeRawCommit({ hash: 'abc12345', id: 'a1b2c3d4' });

    it('should hydrate raw commits into Atoms', async () => {
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[mockCommit.hash, ['src/main.ts']]]));
      
      const result = await hydrator.hydrate([mockCommit]);

      expect(result).toHaveLength(1);
      const atom = result[0];
      expect(atom.commitHash).toBe(mockCommit.hash);
      expect(atom.protocols.get('mock')?.trailers[TEST_ID_KEY]).toEqual(['a1b2c3d4']);
      expect(atom.filesChanged).toEqual(['src/main.ts']);
    });

    it('should use cached files and skip git lookup on cache hit', async () => {
      const cachedFiles = ['src/auth.ts', 'src/util.ts'];
      vi.mocked(atomCache.get).mockResolvedValue({ filesChanged: cachedFiles });

      const result = await hydrator.hydrate([mockCommit]);

      expect(result).toHaveLength(1);
      expect(result[0].filesChanged).toEqual(cachedFiles);
      expect(atomCache.get).toHaveBeenCalledWith(mockCommit.hash);
      expect(gitClient.getFilesChanged).not.toHaveBeenCalled();
    });

    it('should hit git and update cache on cache miss', async () => {
      const gitFiles = ['src/new.ts'];
      vi.mocked(atomCache.get).mockResolvedValue(null);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[mockCommit.hash, gitFiles]]));

      const result = await hydrator.hydrate([mockCommit]);

      expect(result).toHaveLength(1);
      expect(result[0].filesChanged).toEqual(gitFiles);
      expect(atomCache.get).toHaveBeenCalledWith(mockCommit.hash);
      expect(gitClient.getFilesChanged).toHaveBeenCalledWith([mockCommit.hash]);
      expect(atomCache.set).toHaveBeenCalledWith(mockCommit.hash, { filesChanged: gitFiles });
    });

    it('should handle partial cache hits in a batch', async () => {
      const cachedFiles = ['src/cached.ts'];
      const gitFiles = ['src/git.ts'];
      const commit1 = makeRawCommit({ hash: 'hash1', id: 'id1' });
      const commit2 = makeRawCommit({ hash: 'hash2', id: 'id2' });

      vi.mocked(atomCache.get).mockImplementation(async (h) => h === 'hash1' ? { filesChanged: cachedFiles } : null);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['hash2', gitFiles]]));

      const result = await hydrator.hydrate([commit1, commit2]);

      expect(result).toHaveLength(2);
      expect(result[0].filesChanged).toEqual(cachedFiles);
      expect(result[1].filesChanged).toEqual(gitFiles);
      expect(gitClient.getFilesChanged).toHaveBeenCalledWith(['hash2']);
    });

    it('should call getFilesChanged in batches of 20', async () => {
      // 25 commits should result in 2 batches (20 + 5)
      const hashes = Array.from({ length: 25 }, (_, i) => `h${i}`);
      const commits = hashes.map(h => makeRawCommit({ hash: h, id: `id${h}` }));
      
      const filesMap = new Map<string, string[]>();
      hashes.forEach(h => filesMap.set(h, ['file.ts']));
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(filesMap);

      await hydrator.hydrate(commits);

      expect(gitClient.getFilesChanged).toHaveBeenCalledTimes(2);
      expect(vi.mocked(gitClient.getFilesChanged).mock.calls[0][0]).toHaveLength(20);
      expect(vi.mocked(gitClient.getFilesChanged).mock.calls[1][0]).toHaveLength(5);
    });

    it('should respect implicit ownership (protocols get what they define, permissive gets orphans)', async () => {
        // Register two protocols: P1 (strict) and P2 (permissive)
        const localRegistry = makeProtocolRegistry([
            makeProtocol({ 
                name: 'Strict', 
                identityKey: 'S-Key',
                trailers: { 'S-Key': { description: 'S' } } 
            }, { strict: true, permissive: false } as any),
            makeProtocol({ 
                name: 'Permissive', 
                identityKey: 'P-Key',
                trailers: { 'P-Key': { description: 'P' } } 
            }, { strict: false, permissive: true } as any)
        ]);

        const localHydrator = makeAtomHydrator({ gitClient, registry: localRegistry });

        const commit = makeRawCommit({ 
            id: 'aaaa1111', 
            trailers: 'S-Key: aaaa1111\nP-Key: p-val\nOrphan-Key: o-val' 
        });

        const [atom] = await localHydrator.hydrate([commit]);

        const sState = atom.protocols.get('strict')!;
        const pState = atom.protocols.get('permissive')!;

        // Strict only gets what it owns (Identity + P-Key is NOT owned by strict)
        expect(sState.trailers['S-Key']).toEqual(['aaaa1111']);
        expect(sState.trailers['P-Key']).toBeUndefined();
        expect(sState.trailers['Orphan-Key']).toBeUndefined();

        // Permissive gets its own AND orphans
        expect(pState.trailers['P-Key']).toEqual(['p-val']);
        expect(pState.trailers['Orphan-Key']).toEqual(['o-val']);
    });
  });
});
