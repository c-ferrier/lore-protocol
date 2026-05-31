import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomHydrator } from '../../../src/engine/services/atom-hydrator.ts';
import { makeAtomHydrator, makeRawCommit } from '../engine-test-utils.js';
import type { RawCommit } from '../../../src/engine/interfaces/git-client.js';

const TEST_ID_KEY = "Mock-id";

describe('AtomHydrator Contract', () => {
  let gitClient: any;
  let hydrator: AtomHydrator;
  let atomCache: any;

  beforeEach(() => {
    gitClient = {
        getFilesChanged: vi.fn(async () => new Map()),
    } as any;
    atomCache = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
    };
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
  });
});
