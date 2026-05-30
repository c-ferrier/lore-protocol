import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../../src/engine/services/atom-repository.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import type { IGitClient, RawCommit } from '../../../../src/engine/interfaces/git-client.js';
import type { PathQueryOptions } from '../../../../src/engine/types/query.js';
import { 
    MOCK_PROTOCOL_DEFINITION, 
    YAP_PROTOCOL_DEFINITION, 
    makeProtocol, 
    makeAtomRepository, 
    makeProtocolRegistry 
} from '../test-utils.js';

const MOCK_ID_KEY = "Mock-id";

function createMockGitClient(overrides: Partial<IGitClient> = {}): IGitClient {
  return {
    log: vi.fn(async () => []),
    blame: vi.fn(async () => []),
    commit: vi.fn(async () => ({ hash: 'abc123', success: true, message: '' })),
    hasStagedChanges: vi.fn(async () => false),
    getRepoRoot: vi.fn(async () => '/repo'),
    isInsideRepo: vi.fn(async () => true),
    getFilesChanged: vi.fn(async (hashes: string[]) => {
      const map = new Map<string, string[]>();
      for (const hash of hashes) {
        map.set(hash, []);
      }
      return map;
    }),
    countCommitsSince: vi.fn(async () => 0),
    resolveRef: vi.fn(async () => 'head-hash'),
    resolveDate: vi.fn(async (d: string) => {
      const date = new Date(d);
      return isNaN(date.getTime()) ? null : date;
    }),
    getHeadMessage: vi.fn(async () => 'message'),
    getCommitsByHashes: vi.fn(async () => []),
    ...overrides,
  } as any;
}

function makeMockCommit(options: {
  hash?: string;
  date?: string;
  author?: string;
  subject?: string;
  body?: string;
  id?: string;
  trailerExtras?: string;
}): RawCommit {
  const id = options.id ?? 'a1b2c3d4';
  const extras = options.trailerExtras ?? '';
  return {
    hash: options.hash ?? `hash-${id}`,
    date: options.date ?? '2025-01-15T10:00:00Z',
    author: options.author ?? 'dev@example.com',
    subject: options.subject ?? 'feat(auth): add login',
    body: options.body ?? 'Implemented login flow.',
    trailers: `${MOCK_ID_KEY}: ${id}\n${extras}`.trim(),
  };
}

function makeQueryOptions(overrides: Partial<PathQueryOptions> = {}): PathQueryOptions {
  return {
    scope: null,
    follow: false,
    all: false,
    author: null,
    limit: null,
    maxCommits: null,
    since: null,
    until: null,
    ...overrides,
  };
}

describe('AtomRepository', () => {
  let gitClient: IGitClient;
  let repo: AtomRepository;
  let protocolRegistry: ProtocolRegistry;

  beforeEach(() => {
    gitClient = createMockGitClient();
    protocolRegistry = makeProtocolRegistry([makeProtocol(MOCK_PROTOCOL_DEFINITION)]);
    repo = makeAtomRepository({ gitClient, registry: protocolRegistry });
  });

  describe('find', () => {
    it('should return atoms for a file target', async () => {
      const commit = makeMockCommit({ id: 'a1b2c3d4' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[commit.hash, ['src/auth.ts']]]));

      const result = await repo.find({ target: 'src/auth.ts' });

      expect(result).toHaveLength(1);
      expect(result[0].protocols.get('mock')?.trailers[MOCK_ID_KEY]?.[0]).toBe('a1b2c3d4');
      expect(result[0].commitHash).toBe(commit.hash);
      expect(result[0].author).toBe('dev@example.com');
      expect(result[0].filesChanged).toEqual(['src/auth.ts']);
    });

    it('should filter out non-protocol commits', async () => {
      const mockCommit = makeMockCommit({ id: 'a1b2c3d4' });
      const nonMockCommit: RawCommit = {
        hash: 'def456',
        date: '2025-01-16T10:00:00Z',
        author: 'dev@example.com',
        subject: 'chore: update deps',
        body: '',
        trailers: '',
      };

      vi.mocked(gitClient.log).mockResolvedValue([mockCommit, nonMockCommit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[mockCommit.hash, ['src/auth.ts']]]));

      const result = await repo.find({ target: 'src/auth.ts' });

      expect(result).toHaveLength(1);
      expect(result[0].protocols.get('mock')?.trailers[MOCK_ID_KEY]?.[0]).toBe('a1b2c3d4');
    });

    it('should pass author filter to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const options = makeQueryOptions({ author: 'alice@example.com' });
      await repo.find({ target: 'src/auth.ts', ...options });
      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--author=alice@example\\.com');
    });

    it('should pass since filter to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const options = makeQueryOptions({ since: '2025-01-01' });
      await repo.find({ target: 'src/auth.ts', ...options });
      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--since=2025-01-01T00:00:00.000Z');
    });

    it('should pass until filter to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const options = makeQueryOptions({ until: '2025-06-01' });
      await repo.find({ target: 'src/auth.ts', ...options });
      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--until=2025-06-01T00:00:00.000Z');
    });

    it('should pass maxCommits to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const options = makeQueryOptions({ maxCommits: 5 });
      await repo.find({ target: 'src/auth.ts', ...options });
      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--max-count=5');
    });

    it('should return empty array when no commits match', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const result = await repo.find({ target: 'src/auth.ts' });
      expect(result).toEqual([]);
    });

    it('should apply author filter at the application level', async () => {
      const commit1 = makeMockCommit({ id: 'aaaa1111', author: 'alice@example.com' });
      const commit2 = makeMockCommit({ id: 'bbbb2222', author: 'bob@example.com' });
      vi.mocked(gitClient.log).mockResolvedValue([commit1, commit2]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[commit1.hash, ['src/auth.ts']], [commit2.hash, ['src/auth.ts']]]));

      const options = makeQueryOptions({ author: 'alice' });
      const result = await repo.find({ target: 'src/auth.ts', ...options });

      expect(result).toHaveLength(1);
      expect(result[0].author).toBe('alice@example.com');
    });

    it('should not apply limit at the repository level (caller responsibility)', async () => {
      const commits = [
        makeMockCommit({ hash: 'aaa', id: 'aaaa1111' }),
        makeMockCommit({ hash: 'bbb', id: 'bbbb2222' }),
        makeMockCommit({ hash: 'ccc', id: 'cccc3333' }),
      ];
      vi.mocked(gitClient.log).mockResolvedValue(commits);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map(commits.map(c => [c.hash, ['src/auth.ts']])));

      const options = makeQueryOptions({ limit: 2 });
      const result = await repo.find({ target: 'src/auth.ts', ...options });

      expect(result).toHaveLength(3);
    });
  });

  describe('findById', () => {
    it(`should find an atom by its ${MOCK_ID_KEY}`, async () => {
      const commit = makeMockCommit({ id: 'deadbeef' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[commit.hash, ['src/auth.ts']]]));

      const result = await repo.findById({ id: 'deadbeef' });
      expect(result?.protocols.get('mock')?.trailers[MOCK_ID_KEY]?.[0]).toBe('deadbeef');
    });

    it(`should return null if no atom matches the ${MOCK_ID_KEY}`, async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const result = await repo.findById({ id: 'deadbeef' });
      expect(result).toBeNull();
    });

    it(`should return null for invalid ${MOCK_ID_KEY} format`, async () => {
      const result = await repo.findById({ id: 'not-valid' });
      expect(result).toBeNull();
      expect(gitClient.log).not.toHaveBeenCalled();
    });

    it('should append path scope when isScoped=true', async () => {
      const scopedRepo = makeAtomRepository({ gitClient, registry: protocolRegistry, isScoped: true });
      vi.mocked(gitClient.log).mockResolvedValue([]);
      await scopedRepo.findById({ id: 'deadbeef' });
      expect(gitClient.log).toHaveBeenCalledWith(expect.arrayContaining(['--', '.']));
    });
  });

  describe('findByCommitHash', () => {
    it('should fetch and parse a single commit', async () => {
      const commit = makeMockCommit({ id: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[commit.hash, []]]));

      const result = await repo.findByCommitHash(commit.hash);
      expect(result?.commitHash).toBe(commit.hash);
      expect(gitClient.log).toHaveBeenCalledWith(expect.arrayContaining(['-1', commit.hash]));
    });

    it('should return null if no commit found', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const result = await repo.findByCommitHash('abc123');
      expect(result).toBeNull();
    });
  });

  describe('findByRange', () => {
    it('should pass the range directly to git log', async () => {
      await repo.findByRange('main..HEAD');
      expect(gitClient.log).toHaveBeenCalledWith(['main..HEAD']);
    });
  });

  describe('global find', () => {
    it('should return all Mock atoms', async () => {
      const commits = [
        makeMockCommit({ id: 'aaaa1111' }),
        makeMockCommit({ id: 'bbbb2222' }),
      ];
      vi.mocked(gitClient.log).mockResolvedValue(commits);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map(commits.map(c => [c.hash, []])));

      const result = await repo.find();
      expect(result).toHaveLength(2);
    });

    it('should strip trailers from body when body is exactly the trailer block', async () => {
      const trailersRaw = `${MOCK_ID_KEY}: aaaa1111\nConstraint: C1`;
      const commit: RawCommit = {
        hash: 'aaa',
        date: '2025-01-15T10:00:00Z',
        author: 'dev@example.com',
        subject: 'feat: no body',
        body: trailersRaw,
        trailers: trailersRaw,
      };
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['aaa', []]]));

      const result = await repo.find();
      expect(result[0].body).toBe('');
    });

    it('should pass since option to git log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      await repo.find({ since: '2025-01-01' });
      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--since=2025-01-01T00:00:00.000Z');
    });

    it('should pass until option to git log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      await repo.find({ until: '2025-06-01' });
      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--until=2025-06-01T00:00:00.000Z');
    });

    it('should pass maxCommits option to git log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      await repo.find({ maxCommits: 10 });
      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--max-count=10');
    });
  });

  describe('findByScope', () => {
    it('should find atoms matching the scope', async () => {
      const authCommit = makeMockCommit({ subject: 'feat(auth): add login', id: 'aaaa1111' });
      const dbCommit = makeMockCommit({ subject: 'fix(database): fix query', id: 'bbbb2222' });
      vi.mocked(gitClient.log).mockResolvedValue([authCommit, dbCommit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[authCommit.hash, []], [dbCommit.hash, []]]));

      const result = await repo.findByScope('auth', makeQueryOptions());

      expect(result).toHaveLength(1);
      expect(result[0].protocols.get('mock')?.trailers[MOCK_ID_KEY]?.[0]).toBe('aaaa1111');
    });

    it('should match scope case-insensitively', async () => {
      const commit = makeMockCommit({ subject: 'feat(Auth): add login', id: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[commit.hash, []]]));

      const result = await repo.findByScope('auth', makeQueryOptions());
      expect(result).toHaveLength(1);
    });
  });

  describe('Multi-Protocol Hydration', () => {
    it('should hydrate an atom with multiple protocol states if claimed by multiple protocols', async () => {
      const yap = makeProtocol(YAP_PROTOCOL_DEFINITION);
      protocolRegistry.register(yap);

      const trailers = `${MOCK_ID_KEY}: abcd1234\nyap: YAP-id: abcd5678\nyap: Impact: high`;
      const commit: RawCommit = {
        hash: 'multi-hash',
        date: new Date().toISOString(),
        author: 'cole@example.com',
        subject: 'feat: multi-protocol',
        body: 'Body',
        trailers,
      };

      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['multi-hash', []]]));

      const atoms = await repo.find();
      expect(atoms).toHaveLength(1);
      const atom = atoms[0];
      
      expect(atom.protocols.has('mock')).toBe(true);
      expect(atom.protocols.has('yap')).toBe(true);

      const mockState = atom.protocols.get('mock')!;
      expect(mockState.trailers[MOCK_ID_KEY]).toEqual(['abcd1234']);

      const yapState = atom.protocols.get('yap')!;
      expect(yapState.trailers['YAP-id']).toEqual(['abcd5678']);
      expect(yapState.trailers['Impact']).toEqual(['high']);
    });

    it('should respect implicit ownership (protocols get what they define, permissive gets orphans)', async () => {
      // 1. Mock is permissive (greedy)
      const mockProtocol = protocolRegistry.get('mock')!;
      // Need to cast to any because permissive is a getter in the real class but can be mocked
      vi.spyOn(mockProtocol as any, 'permissive', 'get').mockReturnValue(true);

      // 2. YAP is strict but defines its own ID
      const yap = makeProtocol(YAP_PROTOCOL_DEFINITION, { permissive: false });
      protocolRegistry.register(yap);

      // 3. Mock commit: 
      // - Mock-id (Owned by Mock)
      // - YAP-id (Owned by YAP - via namespace)
      // - Impact (Owned by YAP - via namespace)
      // - Adhoc (Owned by NEITHER)
      const trailers = `Mock-id: abcd1234\nyap: YAP-id: abcd5678\nyap: Impact: high\nAdhoc: value`;
      const commit: RawCommit = {
        hash: 'implicit-hash',
        date: new Date().toISOString(),
        author: 'cole@example.com',
        subject: 'feat: implicit claims',
        body: 'Body',
        trailers,
      };

      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['implicit-hash', []]]));

      const atoms = await repo.find();
      const atom = atoms[0];

      const yapState = atom.protocols.get('yap')!;
      const mockState = atom.protocols.get('mock')!;

      // YAP gets what it defines
      expect(yapState.trailers['YAP-id']).toEqual(['abcd5678']);
      expect(yapState.trailers['Impact']).toEqual(['high']);
      
      // Mock gets what it defines
      expect(mockState.trailers['Mock-id']).toEqual(['abcd1234']);
      
      // Mock is permissive so it gets the orphan
      expect(mockState.trailers['Adhoc']).toEqual(['value']);
      
      // IMPORTANT: Mock should NOT get namespaced trailers!
      expect(mockState.trailers['yap']).toBeUndefined();
    });
  });

  describe('Recursive Trace Resolution', () => {
    it('should resolve transitive Related links', async () => {
      const a1 = makeMockCommit({ id: 'aaaa1111', trailerExtras: 'Related: bbbb2222' });
      const a2 = makeMockCommit({ id: 'bbbb2222', trailerExtras: 'Related: cccc3333' });
      const a3 = makeMockCommit({ id: 'cccc3333' });

      vi.mocked(gitClient.log)
        .mockResolvedValueOnce([a1])
        .mockResolvedValueOnce([a2])
        .mockResolvedValueOnce([a3]);
        
      vi.mocked(gitClient.getCommitsByHashes)
        .mockResolvedValueOnce([a1])
        .mockResolvedValueOnce([a2])
        .mockResolvedValueOnce([a3]);

      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([
        [a1.hash, []], [a2.hash, []], [a3.hash, []]
      ]));

      const startAtoms = await repo.findByCommitHash(a1.hash);
      const result = await repo.resolveFollowLinks([startAtoms!], 10);

      expect(result).toHaveLength(3);
      const ids = result.map(a => a.protocols.get('mock')?.trailers[MOCK_ID_KEY]?.[0]);
      expect(ids).toContain('aaaa1111');
      expect(ids).toContain('bbbb2222');
      expect(ids).toContain('cccc3333');
    });

    it('should respect maxDepth in recursive resolution', async () => {
      const a1 = makeMockCommit({ id: 'aaaa1111', trailerExtras: 'Related: bbbb2222' });
      const a2 = makeMockCommit({ id: 'bbbb2222', trailerExtras: 'Related: cccc3333' });

      vi.mocked(gitClient.log).mockResolvedValueOnce([a1]).mockResolvedValueOnce([a2]);
      vi.mocked(gitClient.getCommitsByHashes).mockResolvedValueOnce([a1]).mockResolvedValueOnce([a2]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[a1.hash, []], [a2.hash, []]]));

      const start = await repo.findByCommitHash(a1.hash);
      const result = await repo.resolveFollowLinks([start!], 1); // Depth 1 only

      expect(result).toHaveLength(2);
      expect(vi.mocked(gitClient.log)).toHaveBeenCalledTimes(2); 
    });

    it('should handle circular references without infinite loop', async () => {
      const a1 = makeMockCommit({ id: 'aaaa1111', trailerExtras: 'Related: bbbb2222' });
      const a2 = makeMockCommit({ id: 'bbbb2222', trailerExtras: 'Related: aaaa1111' });

      vi.mocked(gitClient.log).mockResolvedValue([a1, a2]);
      vi.mocked(gitClient.getCommitsByHashes).mockResolvedValue([a1, a2]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[a1.hash, []], [a2.hash, []]]));

      const start = await repo.findByCommitHash(a1.hash);
      const result = await repo.resolveFollowLinks([start!], 5);

      expect(result).toHaveLength(2);
    });

    it('should return empty array for empty input', async () => {
      const result = await repo.resolveFollowLinks([], 3);
      expect(result).toEqual([]);
    });
  });

  describe('Scoped Repositories', () => {
    it('should append path scope when isScoped=true in findByCommitHash', async () => {
      const scopedRepo = makeAtomRepository({ gitClient, registry: protocolRegistry, isScoped: true });
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await scopedRepo.findByCommitHash('abc123');

      expect(gitClient.log).toHaveBeenCalledWith(
        expect.arrayContaining(['-1', 'abc123', '--', '.']),
      );
    });

    it('should append path scope when isScoped=true in findByRange', async () => {
      const scopedRepo = makeAtomRepository({ gitClient, registry: protocolRegistry, isScoped: true });
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await scopedRepo.findByRange('main..HEAD');

      expect(gitClient.log).toHaveBeenCalledWith(['main..HEAD', '--', '.']);
    });
  });

  describe('batching behavior', () => {
    it('should call getFilesChanged in batches of 20', async () => {
      const commits = Array.from({ length: 25 }, (_, i) =>
        makeMockCommit({ id: String(i).padStart(8, '0') }),
      );
      vi.mocked(gitClient.log).mockResolvedValue(commits);
      
      const filesMap = new Map<string, string[]>();
      commits.forEach(c => filesMap.set(c.hash, ['file.ts']));
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(filesMap);

      await repo.find();

      expect(gitClient.getFilesChanged).toHaveBeenCalledTimes(2);
      expect(vi.mocked(gitClient.getFilesChanged).mock.calls[0][0]).toHaveLength(20);
      expect(vi.mocked(gitClient.getFilesChanged).mock.calls[1][0]).toHaveLength(5);
    });
  });
});
