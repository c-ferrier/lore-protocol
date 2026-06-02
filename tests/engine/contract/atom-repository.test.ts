import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import type { RawCommit } from '../../../src/engine/interfaces/git-client.js';
import type { PathQueryOptions } from '../../../src/engine/types/query.js';
import { 
    TEST_PROTOCOL_DEFINITION, 
    makeProtocol, 
    makeAtomRepository, 
    makeProtocolRegistry,
    makeMockGitClient,
    makeRawCommit,
    makeQueryOptions,
    makeQueryTarget,
    NullQueryCache,
} from '../engine-test-utils.js';
import { ProtocolError } from '../../../src/engine/util/errors.js';

const TEST_ID_KEY = "Mock-id";

describe('AtomRepository', () => {
  let gitClient: any;
  let repo: AtomRepository;
  let protocolRegistry: ProtocolRegistry;

  beforeEach(() => {
    gitClient = makeMockGitClient({
        resolveDate: vi.fn(async (d: string) => {
            const date = new Date(d);
            return isNaN(date.getTime()) ? new Date('2025-01-01') : date;
        })
    });
    protocolRegistry = makeProtocolRegistry([makeProtocol(TEST_PROTOCOL_DEFINITION)]);
    repo = makeAtomRepository({ gitClient, registry: protocolRegistry });
  });

  describe('find', () => {
    it('should return atoms for a file target', async () => {
      const commit = makeRawCommit({ id: 'a1b2c3d4', filesChanged: ['src/auth.ts'] });
      vi.mocked(gitClient.query).mockResolvedValue([commit]);

      const result = await repo.find(makeQueryTarget('src/auth.ts'));

      expect(result).toHaveLength(1);
      expect(result[0].protocols.get('mock')?.trailers[TEST_ID_KEY]?.[0]).toBe('a1b2c3d4');
      expect(result[0].commitHash).toBe(commit.hash);
      expect(result[0].author).toBe('dev@example.com');
      expect(result[0].filesChanged).toEqual(['src/auth.ts']);
    });

    it('should resolve date strings before querying', async () => {
        vi.mocked(gitClient.query).mockResolvedValue([]);
        await repo.find(makeQueryTarget(), { since: '2025-01-01' });
        expect(gitClient.resolveDate).toHaveBeenCalledWith('2025-01-01');
    });

    it('should filter out non-protocol commits', async () => {
      const mockCommit = makeRawCommit({ id: 'a1b2c3d4' });
      const nonMockCommit: RawCommit = {
        hash: 'def456',
        date: '2025-01-16T10:00:00Z',
        author: 'dev@example.com',
        subject: 'chore: update deps',
        body: '',
        trailers: '',
      };

      vi.mocked(gitClient.query).mockResolvedValue([mockCommit, nonMockCommit]);

      const result = await repo.find(makeQueryTarget('src/auth.ts'));

      expect(result).toHaveLength(1);
      expect(result[0].protocols.get('mock')?.trailers[TEST_ID_KEY]?.[0]).toBe('a1b2c3d4');
    });

    it('should pass author filter to GitClient.query', async () => {
      vi.mocked(gitClient.query).mockResolvedValue([]);
      const options = makeQueryOptions({ author: 'alice@example.com' });
      await repo.find(makeQueryTarget('src/auth.ts'), options);
      const query = vi.mocked(gitClient.query).mock.calls[0][0];
      expect(query.author).toBe('alice@example.com');
    });

    it('should apply author filter at the application level (Secondary Pass)', async () => {
      const commit1 = makeRawCommit({ id: 'aaaa1111', author: 'alice@example.com' });
      const commit2 = makeRawCommit({ id: 'bbbb2222', author: 'bob@example.com' });
      vi.mocked(gitClient.query).mockResolvedValue([commit1, commit2]);

      const options = makeQueryOptions({ author: 'alice' });
      const result = await repo.find(makeQueryTarget('src/auth.ts'), options);

      expect(result).toHaveLength(1);
      expect(result[0].author).toBe('alice@example.com');
    });

    it('should strip trailers from body when body is exactly the trailer block', async () => {
      const commit = makeRawCommit({ 
        id: 'aaaa1111', 
        body: 'Mock-id: aaaa1111', // Body is same as trailers
        trailers: 'Mock-id: aaaa1111' 
      });
      vi.mocked(gitClient.query).mockResolvedValue([commit]);

      const result = await repo.find();
      expect(result[0].body).toBe('');
    });

    it('should not apply limit at the repository level (caller responsibility)', async () => {
      const commits = [
        makeRawCommit({ hash: 'aaa', id: 'aaaa1111' }),
        makeRawCommit({ hash: 'bbb', id: 'bbbb2222' }),
        makeRawCommit({ hash: 'ccc', id: 'cccc3333' }),
      ];
      vi.mocked(gitClient.query).mockResolvedValue(commits);

      const options = makeQueryOptions({ limit: 2 });
      const result = await repo.find(makeQueryTarget('src/auth.ts'), options);

      expect(result).toHaveLength(3);
    });

    it('should return empty array when no commits match', async () => {
      vi.mocked(gitClient.query).mockResolvedValue([]);
      const result = await repo.find(makeQueryTarget('src/auth.ts'));
      expect(result).toEqual([]);
    });

    it('should handle multi-file targets correctly', async () => {
      const commit1 = makeRawCommit({ hash: 'h1', id: 'aaaa1111' });
      const commit2 = makeRawCommit({ hash: 'h2', id: 'bbbb2222' });
      vi.mocked(gitClient.query).mockResolvedValue([commit1, commit2]);

      const result = await repo.find(makeQueryTarget(['file1.ts', 'file2.ts']));

      expect(result).toHaveLength(2);
      const query = vi.mocked(gitClient.query).mock.calls[0][0];
      expect(query.paths).toContain('file1.ts');
      expect(query.paths).toContain('file2.ts');
    });
  });

  describe('findByLineRange', () => {
    it('should return atoms for a line range target', async () => {
      const commit = makeRawCommit({ id: 'a1b2c3d4', trailers: 'Mock-id: a1b2c3d4' });
      vi.mocked(gitClient.blame).mockResolvedValue([{ commitHash: commit.hash, lineNumber: 10, content: 'code' }]);
      vi.mocked(gitClient.getCommitsByHashes).mockResolvedValue([commit]);

      const result = await repo.find(makeQueryTarget('src/auth.ts:10-20'));

      expect(result).toHaveLength(1);
      expect(result[0].commitHash).toBe(commit.hash);
      expect(gitClient.blame).toHaveBeenCalledWith('src/auth.ts', 10, 20);
    });

    it('should deduplicate atoms by identity', async () => {
      const commit1 = makeRawCommit({ hash: 'h1', id: 'aaaa1111', trailers: 'Mock-id: aaaa1111' });
      const commit2 = makeRawCommit({ hash: 'h2', id: 'aaaa1111', trailers: 'Mock-id: aaaa1111' }); // Same identity, different hash
      
      vi.mocked(gitClient.blame).mockResolvedValue([
        { commitHash: 'h1', lineNumber: 10, content: 'a' },
        { commitHash: 'h2', lineNumber: 11, content: 'b' }
      ]);
      vi.mocked(gitClient.getCommitsByHashes).mockResolvedValue([commit1, commit2]);

      const result = await repo.find(makeQueryTarget('src/auth.ts:10-20'));

      expect(result).toHaveLength(1); // Deduplicated
      expect(result[0].protocols.get('mock')?.trailers[TEST_ID_KEY]).toEqual(['aaaa1111']);
    });
  });

  describe('findById', () => {
    it('should find an atom by its Mock-id', async () => {
      const commit = makeRawCommit({ id: 'deadbeef' });
      vi.mocked(gitClient.query).mockResolvedValue([commit]);

      const result = await repo.findById({ id: 'deadbeef' });

      expect(result?.protocols.get('mock')?.trailers[TEST_ID_KEY]?.[0]).toBe('deadbeef');
    });

    it('should return null if no atom matches the Mock-id', async () => {
      vi.mocked(gitClient.query).mockResolvedValue([]);
      const result = await repo.findById({ id: 'missing' });
      expect(result).toBeNull();
    });

    it('should return null for invalid Mock-id format', async () => {
      const result = await repo.findById({ id: 'not-hex-id' });
      expect(result).toBeNull();
      expect(gitClient.query).not.toHaveBeenCalled();
    });

    it('should append path scope when isScoped=true', async () => {
      const scopedRepo = makeAtomRepository({ gitClient, registry: protocolRegistry, isScoped: true });
      vi.mocked(gitClient.query).mockResolvedValue([]);
      
      await scopedRepo.findById({ id: 'deadbeef' });
      
      expect(gitClient.query).toHaveBeenCalledWith(expect.objectContaining({
          paths: expect.arrayContaining(['.'])
      }));
    });
  });

  describe('findByIds', () => {
    it('should find atoms by their Mock-ids', async () => {
      const c1 = makeRawCommit({ hash: 'h1', id: 'aaaa1111' });
      const c2 = makeRawCommit({ hash: 'h2', id: 'bbbb2222' });
      vi.mocked(gitClient.query).mockResolvedValue([c1, c2]);

      const results = await repo.findByIds([
          { id: 'aaaa1111' },
          { id: 'bbbb2222' }
      ]);

      expect(results).toHaveLength(2);
      expect(results.map(a => a.commitHash)).toEqual(['h1', 'h2']);
    });

    it('should return empty array for empty identities', async () => {
        const results = await repo.findByIds([]);
        expect(results).toHaveLength(0);
        expect(gitClient.query).not.toHaveBeenCalled();
    });

    it('should handle multiple protocols correctly', async () => {
        const localRegistry = new ProtocolRegistry();
        localRegistry.register(makeProtocol({ name: 'p1', identityKey: 'P1-id' }, { permissive: false }));
        localRegistry.register(makeProtocol({ name: 'p2', identityKey: 'P2-id' }, { permissive: false }));
        const localRepo = makeAtomRepository({ gitClient, registry: localRegistry });

        const c1 = makeRawCommit({ hash: 'h1', id: 'aaaa1111', trailers: 'P1-id: aaaa1111' });
        const c2 = makeRawCommit({ hash: 'h2', id: 'bbbb2222', trailers: 'P2-id: bbbb2222' });
        vi.mocked(gitClient.query).mockResolvedValue([c1, c2]);

        const results = await localRepo.findByIds([
            { protocol: 'p1', id: 'aaaa1111' },
            { protocol: 'p2', id: 'bbbb2222' }
        ]);

        expect(results).toHaveLength(2);
    });
  });

  describe('findByCommitHash', () => {
    it('should fetch and parse a single commit', async () => {
      const commit = makeRawCommit({ hash: 'abc12345' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);

      const result = await repo.findByCommitHash('abc12345');

      expect(result?.commitHash).toBe('abc12345');
      expect(gitClient.log).toHaveBeenCalledWith(expect.arrayContaining(['-1', 'abc12345']));
    });

    it('should return null if no commit found', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const result = await repo.findByCommitHash('missing');
      expect(result).toBeNull();
    });
  });

  describe('findByRange', () => {
    it('should pass the range directly to git log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      await repo.findByRange('main..HEAD');
      expect(gitClient.log).toHaveBeenCalledWith(expect.arrayContaining(['main..HEAD']));
    });
  });

  describe('global find', () => {
    it('should return all Mock atoms', async () => {
      const commits = [
        makeRawCommit({ hash: 'h1', id: 'aaaa1111' }),
        makeRawCommit({ hash: 'h2', id: 'bbbb2222' })
      ];
      vi.mocked(gitClient.query).mockResolvedValue(commits);

      const result = await repo.find();

      expect(result).toHaveLength(2);
      expect(result[0].protocols.get('mock')?.trailers[TEST_ID_KEY]?.[0]).toBe('aaaa1111');
    });

    it('should pass since option to GitClient.query', async () => {
      vi.mocked(gitClient.query).mockResolvedValue([]);
      await repo.find(undefined, { since: '2025-01-01' });
      const query = vi.mocked(gitClient.query).mock.calls[0][0];
      expect(query.sinceDate).toBeDefined();
    });

    it('should pass until option to GitClient.query', async () => {
      vi.mocked(gitClient.query).mockResolvedValue([]);
      await repo.find(undefined, { until: '2025-06-01' });
      const query = vi.mocked(gitClient.query).mock.calls[0][0];
      expect(query.untilDate).toBeDefined();
    });

    it('should pass maxCommits option to GitClient.query', async () => {
      vi.mocked(gitClient.query).mockResolvedValue([]);
      await repo.find(undefined, { maxCommits: 50 });
      const query = vi.mocked(gitClient.query).mock.calls[0][0];
      expect(query.limit).toBe(50);
    });
  });

  describe('findByScope', () => {
    it('should find atoms matching the scope', async () => {
      const commit = makeRawCommit({ id: '00000001', subject: 'feat(auth): login' });
      vi.mocked(gitClient.query).mockResolvedValue([commit]);

      const result = await repo.findByScope('auth', {});

      expect(result).toHaveLength(1);
      const query = vi.mocked(gitClient.query).mock.calls[0][0];
      const found = query.regexPatterns.some((set: string[]) => set.some(p => p.includes('auth')));
      expect(found).toBe(true);
    });

    it('match scope case-insensitively', async () => {
      const commit = makeRawCommit({ id: '00000001', subject: 'feat(auth): login' });
      vi.mocked(gitClient.query).mockResolvedValue([commit]);

      const result = await repo.findByScope('AUTH', {});

      expect(result).toHaveLength(1);
      const query = vi.mocked(gitClient.query).mock.calls[0][0];
      const found = query.regexPatterns.some((set: string[]) => set.some(p => p.includes('AUTH')));
      expect(found).toBe(true);
    });
  });

  describe('Multi-Protocol Hydration', () => {
    it('should hydrate an atom with multiple protocol states if claimed by multiple protocols', async () => {
      const localRegistry = new ProtocolRegistry();
      localRegistry.register(makeProtocol({
        name: 'p1',
        identityKey: 'P1-id',
        trailers: { 'P1-id': { description: 'ID' } }
      }, { permissive: false }));
      localRegistry.register(makeProtocol({
        name: 'p2',
        identityKey: 'P2-id',
        trailers: { 'P2-id': { description: 'ID' } }
      }, { permissive: false }));


      const localRepo = makeAtomRepository({ gitClient, registry: localRegistry });

      const commit: RawCommit = {
        hash: 'multi123',
        date: '2025-01-16T10:00:00Z',
        author: 'dev@example.com',
        subject: 'feat: multi',
        body: 'body',
        trailers: 'P1-id: a1b2c3d4\nP2-id: f1a2b3'
      };

      vi.mocked(gitClient.query).mockResolvedValue([commit]);

      const result = await localRepo.find();

      expect(result).toHaveLength(1);
      const atom = result[0];
      expect(atom.protocols.has('p1')).toBe(true);
      expect(atom.protocols.has('p2')).toBe(true);
    });
  });

  describe('Recursive Trace Resolution', () => {
    it('should resolve transitive Related links', async () => {
      const id1 = '00000001';
      const id2 = '00000002';
      const id3 = '00000003';

      const a1 = makeRawCommit({ hash: 'h1', id: id1, trailers: `Mock-id: ${id1}\nRelated: ${id2}` });
      const a2 = makeRawCommit({ hash: 'h2', id: id2, trailers: `Mock-id: ${id2}\nRelated: ${id3}` });
      const a3 = makeRawCommit({ hash: 'h3', id: id3, trailers: `Mock-id: ${id3}` });

      vi.mocked(gitClient.query)
        .mockResolvedValueOnce([a1]) 
        .mockResolvedValueOnce([a2]) 
        .mockResolvedValueOnce([a3]); 

      const initial = await repo.find();
      const resolved = await repo.resolveFollowLinks(initial, 5);

      expect(resolved).toHaveLength(3);
      expect(resolved.map(a => a.commitHash)).toEqual(['h1', 'h2', 'h3']);
    });

    it('should respect maxDepth in recursive resolution', async () => {
      const id1 = '00000001';
      const id2 = '00000002';

      const a1 = makeRawCommit({ hash: 'h1', id: id1, trailers: `Mock-id: ${id1}\nRelated: ${id2}` });
      const a2 = makeRawCommit({ hash: 'h2', id: id2, trailers: `Mock-id: ${id2}` });

      vi.mocked(gitClient.query)
        .mockResolvedValueOnce([a1])
        .mockResolvedValueOnce([a2]);

      const initial = await repo.find();
      const resolved = await repo.resolveFollowLinks(initial, 1);

      expect(resolved).toHaveLength(2);
    });

    it('should handle circular references without infinite loop', async () => {
        const id1 = '00000001';
        const id2 = '00000002';
  
        const a1 = makeRawCommit({ hash: 'h1', id: id1, trailers: `Mock-id: ${id1}\nRelated: ${id2}` });
        const a2 = makeRawCommit({ hash: 'h2', id: id2, trailers: `Mock-id: ${id2}\nRelated: ${id1}` });
  
        vi.mocked(gitClient.query).mockResolvedValueOnce([a1, a2]);
  
        const initial = await repo.find();
        const resolved = await repo.resolveFollowLinks(initial, 5);
  
        expect(resolved).toHaveLength(2);
        expect(gitClient.query).toHaveBeenCalledTimes(2); 
    });

    it('should return empty array for empty input', async () => {
        const resolved = await repo.resolveFollowLinks([], 5);
        expect(resolved).toEqual([]);
    });
  });

  describe('Scoped Repositories', () => {
    it('should append path scope when isScoped=true in findByCommitHash', async () => {
      const scopedRepo = makeAtomRepository({ gitClient, registry: protocolRegistry, isScoped: true });
      vi.mocked(gitClient.log).mockResolvedValue([]);
      
      await scopedRepo.findByCommitHash('abc123');
      expect(gitClient.log).toHaveBeenCalledWith(expect.arrayContaining(['.']));
    });

    it('should append path scope when isScoped=true in findByRange', async () => {
      const scopedRepo = makeAtomRepository({ gitClient, registry: protocolRegistry, isScoped: true });
      vi.mocked(gitClient.log).mockResolvedValue([]);
      
      await scopedRepo.findByRange('main..HEAD');
      expect(gitClient.log).toHaveBeenCalledWith(['main..HEAD', '.']);
    });
  });

  describe('Base Target Fallback', () => {
    it('should use baseTarget when no target is provided', async () => {
        const baseTarget = makeQueryTarget(['src/scoped']);
        const repoWithBase = new AtomRepository(
            gitClient, (repo as any).hydrator, protocolRegistry, (repo as any).searchFilter, new NullQueryCache(), baseTarget
        );

        vi.mocked(gitClient.query).mockResolvedValue([]);
        await repoWithBase.find();

        const query = vi.mocked(gitClient.query).mock.calls[0][0];
        expect(query.paths).toEqual(['src/scoped']);
    });

    it('should override baseTarget when explicit target is provided', async () => {
        const baseTarget = makeQueryTarget(['src/scoped']);
        const repoWithBase = new AtomRepository(
            gitClient, (repo as any).hydrator, protocolRegistry, (repo as any).searchFilter, new NullQueryCache(), baseTarget
        );

        vi.mocked(gitClient.query).mockResolvedValue([]);
        await repoWithBase.find(makeQueryTarget('override.ts'));

        const query = vi.mocked(gitClient.query).mock.calls[0][0];
        expect(query.paths).toEqual(['override.ts']);
    });
  });
});
