import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../src/services/atom-repository.js';
import { Protocol } from '../../../src/services/protocol.js';
import { SearchFilter } from '../../../src/services/search-filter.js';
import { NullAtomCache } from '../../../src/services/atom-cache.js';
import type { IGitClient, RawCommit } from '../../../src/interfaces/git-client.js';
import type { PathQueryOptions } from '../../../src/types/query.js';
import type { LoreTrailers } from '../../../src/types/domain.js';
import { DEFAULT_CONFIG, LORE_ID_KEY } from '../../../src/util/constants.js';

/**
 * Minimal TrailerParser mock that satisfies the AtomRepository's usage.
 */
function createMockTrailerParser() {
  return {
    containsLoreTrailers: vi.fn((text: string) => text.includes(LORE_ID_KEY)),
    parse: vi.fn((rawTrailers: string): LoreTrailers => {
      const trailers = parseTrailersFromText(rawTrailers);
      return trailers;
    }),
    serialize: vi.fn(() => ''),
    extractTrailerBlock: vi.fn(() => ''),
  };
}

/**
 * Simple trailer text parser for tests.
 * Extracts key: value pairs from a multi-line trailer block.
 */
function parseTrailersFromText(raw: string): LoreTrailers {
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  
  const result: any = {
    [LORE_ID_KEY]: [],
    Constraint: [],
    Rejected: [],
    Confidence: [],
    'Scope-risk': [],
    Reversibility: [],
    Directive: [],
    Tested: [],
    'Not-tested': [],
    Supersedes: [],
    'Depends-on': [],
    Related: [],
  };

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    const value = line.substring(colonIdx + 1).trim();

    if (result[key]) {
      result[key].push(value);
    } else {
      result[key] = [value];
    }
  }

  return result;
}

function createMockGitClient(overrides: Partial<IGitClient> = {}): IGitClient {
  return {
    log: vi.fn(async () => []),
    blame: vi.fn(async () => []),
    commit: vi.fn(async () => ({ hash: 'abc123', success: true })),
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
    resolveRef: vi.fn(async () => 'abc123'),
    resolveDate: vi.fn(async (d: string) => {
      const date = new Date(d);
      return isNaN(date.getTime()) ? null : date;
    }),
    getHeadMessage: vi.fn(async () => 'message'),
    ...overrides,
  } as any;
}

function makeLoreCommit(options: {
  hash?: string;
  date?: string;
  author?: string;
  subject?: string;
  body?: string;
  loreId?: string;
  trailerExtras?: string;
}): RawCommit {
  const loreId = options.loreId ?? 'a1b2c3d4';
  const extras = options.trailerExtras ?? '';
  return {
    hash: options.hash ?? 'abc12345',
    date: options.date ?? '2025-01-15T10:00:00Z',
    author: options.author ?? 'dev@example.com',
    subject: options.subject ?? 'feat(auth): add login',
    body: options.body ?? 'Implemented login flow.',
    trailers: `${LORE_ID_KEY}: ${loreId}\n${extras}`.trim(),
  };
}

function makeGitLogArgs(filePath: string = 'src/auth.ts'): readonly string[] {
  return ['--', filePath];
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
  let trailerParser: ReturnType<typeof createMockTrailerParser>;
  let repo: AtomRepository;
  let protocol: Protocol;
  let searchFilter: SearchFilter;
  let atomCache: NullAtomCache;

  beforeEach(() => {
    gitClient = createMockGitClient();
    trailerParser = createMockTrailerParser();
    protocol = new Protocol(DEFAULT_CONFIG);
    searchFilter = new SearchFilter();
    atomCache = new NullAtomCache();
    repo = new AtomRepository(gitClient, trailerParser as any, protocol, searchFilter, atomCache);
  });

  describe('findByTarget', () => {
    it('should return atoms for a file target', async () => {
      const commit = makeLoreCommit({ loreId: 'a1b2c3d4' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['abc12345', ['src/auth.ts']]]));

      const gitLogArgs = makeGitLogArgs();
      const options = makeQueryOptions();
      const result = await repo.findByTarget(gitLogArgs, options);

      expect(result).toHaveLength(1);
      expect(result[0].loreId).toBe('a1b2c3d4');
      expect(result[0].commitHash).toBe('abc12345');
      expect(result[0].author).toBe('dev@example.com');
      expect(result[0].filesChanged).toEqual(['src/auth.ts']);
    });

    it('should filter out non-Lore commits', async () => {
      const loreCommit = makeLoreCommit({ loreId: 'a1b2c3d4' });
      const nonLoreCommit: RawCommit = {
        hash: 'def456',
        date: '2025-01-16T10:00:00Z',
        author: 'dev@example.com',
        subject: 'chore: update deps',
        body: '',
        trailers: '',
      };

      vi.mocked(gitClient.log).mockResolvedValue([loreCommit, nonLoreCommit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['abc12345', ['src/auth.ts']]]));

      const result = await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(result).toHaveLength(1);
      expect(result[0].loreId).toBe('a1b2c3d4');
    });

    it('should pass author filter to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const options = makeQueryOptions({ author: 'alice@example.com' });
      await repo.findByTarget(makeGitLogArgs(), options);

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--author=alice@example.com');
    });

    it('should pass since filter to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const options = makeQueryOptions({ since: '2025-01-01' });
      await repo.findByTarget(makeGitLogArgs(), options);

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--since=2025-01-01T00:00:00.000Z');
    });

    it('should pass until filter to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const options = makeQueryOptions({ until: '2025-06-01' });
      await repo.findByTarget(makeGitLogArgs(), options);

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--until=2025-06-01T00:00:00.000Z');
    });

    it('should pass maxCommits to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const options = makeQueryOptions({ maxCommits: 5 });
      await repo.findByTarget(makeGitLogArgs(), options);

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--max-count=5');
    });

    it('should return empty array when no commits match', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const result = await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(result).toEqual([]);
    });

    it('should apply author filter at the application level', async () => {
      const commit1 = makeLoreCommit({ hash: 'aaa', author: 'alice@example.com', loreId: 'aaaa1111' });
      const commit2 = makeLoreCommit({ hash: 'bbb', author: 'bob@example.com', loreId: 'bbbb2222' });
      vi.mocked(gitClient.log).mockResolvedValue([commit1, commit2]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['aaa', ['src/auth.ts']], ['bbb', ['src/auth.ts']]]));

      const options = makeQueryOptions({ author: 'alice' });
      const result = await repo.findByTarget(makeGitLogArgs(), options);

      expect(result).toHaveLength(1);
      expect(result[0].author).toBe('alice@example.com');
    });

    it('should not apply limit at the repository level (caller responsibility)', async () => {
      const commits = [
        makeLoreCommit({ hash: 'aaa', loreId: 'aaaa1111' }),
        makeLoreCommit({ hash: 'bbb', loreId: 'bbbb2222' }),
        makeLoreCommit({ hash: 'ccc', loreId: 'cccc3333' }),
      ];
      vi.mocked(gitClient.log).mockResolvedValue(commits);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map(commits.map(c => [c.hash, ['src/auth.ts']])));

      const options = makeQueryOptions({ limit: 2 });
      const result = await repo.findByTarget(makeGitLogArgs(), options);

      expect(result).toHaveLength(3);
    });
  });

  describe('findByLoreId', () => {
    it(`should find an atom by its ${LORE_ID_KEY}`, async () => {
      const commit = makeLoreCommit({ loreId: 'deadbeef' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[commit.hash, ['src/auth.ts']]]));

      const result = await repo.findByLoreId('deadbeef');

      expect(result).not.toBeNull();
      expect(result!.loreId).toBe('deadbeef');
    });

    it(`should return null if no atom matches the ${LORE_ID_KEY}`, async () => {
      const commit = makeLoreCommit({ loreId: 'a1b2c3d4' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map());

      const result = await repo.findByLoreId('deadbeef');

      expect(result).toBeNull();
    });

    it(`should return null for invalid ${LORE_ID_KEY} format`, async () => {
      const result = await repo.findByLoreId('not-valid');

      expect(result).toBeNull();
      expect(gitClient.log).not.toHaveBeenCalled();
    });

    it(`should return null for empty ${LORE_ID_KEY}`, async () => {
      const result = await repo.findByLoreId('');

      expect(result).toBeNull();
    });

    it('should append path scope when isScoped=true', async () => {
      const scopedRepo = new AtomRepository(gitClient, trailerParser as any, protocol, searchFilter, atomCache, true);
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await scopedRepo.findByLoreId('deadbeef');

      expect(gitClient.log).toHaveBeenCalledWith(
        expect.arrayContaining(['--', '.']),
      );
    });
  });

  describe('findByCommitHash', () => {
    it('should fetch and parse a single commit', async () => {
      const commit = makeLoreCommit({ hash: 'abc123', loreId: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['abc123', []]]));

      const result = await repo.findByCommitHash('abc123');

      expect(result).not.toBeNull();
      expect(result?.commitHash).toBe('abc123');
      expect(gitClient.log).toHaveBeenCalledWith(expect.arrayContaining(['-1', 'abc123']));
    });

    it('should return null if no commit found', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const result = await repo.findByCommitHash('abc123');
      expect(result).toBeNull();
    });

    it('should append path scope when isScoped=true', async () => {
      const scopedRepo = new AtomRepository(gitClient, trailerParser as any, protocol, searchFilter, atomCache, true);
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await scopedRepo.findByCommitHash('abc123');

      expect(gitClient.log).toHaveBeenCalledWith(
        expect.arrayContaining(['-1', 'abc123', '--', '.']),
      );
    });
  });

  describe('findByRange', () => {
    it('should pass the range directly to git log', async () => {
      await repo.findByRange('main..HEAD');
      expect(gitClient.log).toHaveBeenCalledWith(['main..HEAD']);
    });

    it('should append path scope when isScoped=true', async () => {
      const scopedRepo = new AtomRepository(gitClient, trailerParser as any, protocol, searchFilter, atomCache, true);
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await scopedRepo.findByRange('main..HEAD');

      expect(gitClient.log).toHaveBeenCalledWith(['main..HEAD', '--', '.']);
    });
  });

  describe('findAll', () => {
    it('should return all Lore atoms', async () => {
      const commits = [
        makeLoreCommit({ hash: 'aaa', loreId: 'aaaa1111' }),
        makeLoreCommit({ hash: 'bbb', loreId: 'bbbb2222' }),
      ];
      vi.mocked(gitClient.log).mockResolvedValue(commits);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['aaa', []], ['bbb', []]]));

      const result = await repo.findAll();

      expect(result).toHaveLength(2);
    });

    it('should strip trailers from body when body is exactly the trailer block', async () => {
      const trailersRaw = `${LORE_ID_KEY}: aaaa1111\nDirective: keep simple`;
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

      const result = await repo.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('');
    });

    it('should pass since option to git log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await repo.findAll({ since: '2025-01-01' });

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--since=2025-01-01T00:00:00.000Z');
    });

    it('should pass until option to git log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await repo.findAll({ until: '2025-06-01' });

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--until=2025-06-01T00:00:00.000Z');
    });

    it('should pass maxCommits option to git log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await repo.findAll({ maxCommits: 10 });

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--max-count=10');
    });

    it('should return empty array when no Lore commits exist', async () => {
      const nonLoreCommit: RawCommit = {
        hash: 'abc',
        date: '2025-01-15T10:00:00Z',
        author: 'dev@example.com',
        subject: 'chore: update deps',
        body: '',
        trailers: '',
      };
      vi.mocked(gitClient.log).mockResolvedValue([nonLoreCommit]);

      const result = await repo.findAll();

      expect(result).toEqual([]);
    });

    it('should append path scope when isScoped=true', async () => {
      const scopedRepo = new AtomRepository(gitClient, trailerParser as any, protocol, searchFilter, atomCache, true);
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await scopedRepo.findAll();

      expect(gitClient.log).toHaveBeenCalledWith(
        expect.arrayContaining(['--', '.']),
      );
    });
  });

  describe('findAll with scope', () => {
    it('should find atoms matching the scope', async () => {
      const authCommit = makeLoreCommit({ subject: 'feat(auth): add login', loreId: 'aaaa1111' });
      const dbCommit = makeLoreCommit({ subject: 'fix(database): fix query', loreId: 'bbbb2222' });
      vi.mocked(gitClient.log).mockResolvedValue([authCommit, dbCommit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[authCommit.hash, []], [dbCommit.hash, []]]));

      const result = await repo.findAll({ ...makeQueryOptions(), scope: 'auth' });

      expect(result).toHaveLength(1);
      expect(result[0].loreId).toBe('aaaa1111');
    });

    it('should match scope case-insensitively', async () => {
      const commit = makeLoreCommit({ subject: 'feat(Auth): add login', loreId: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[commit.hash, []]]));

      const result = await repo.findAll({ ...makeQueryOptions(), scope: 'auth' });

      expect(result).toHaveLength(1);
    });

    it('should return empty array when no scope matches', async () => {
      const commit = makeLoreCommit({ subject: 'feat(auth): add login', loreId: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[commit.hash, []]]));

      const result = await repo.findAll({ ...makeQueryOptions(), scope: 'payments' });

      expect(result).toEqual([]);
    });

    it('should handle commits without scope in subject', async () => {
      const commit = makeLoreCommit({ subject: 'fix: typo', loreId: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[commit.hash, []]]));

      const result = await repo.findAll({ ...makeQueryOptions(), scope: 'auth' });

      expect(result).toEqual([]);
    });

    it('should append path scope when isScoped=true', async () => {
      const scopedRepo = new AtomRepository(gitClient, trailerParser as any, protocol, searchFilter, atomCache, true);
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await scopedRepo.findByScope('auth', makeQueryOptions());

      expect(gitClient.log).toHaveBeenCalledWith(
        expect.arrayContaining(['--', '.']),
      );
    });
  });

  describe('resolveFollowLinks', () => {
    it('should resolve atoms referenced by Related trailers', async () => {
      const commit1 = makeLoreCommit({ hash: 'aaa', loreId: 'aaaa1111', trailerExtras: 'Related: bbbb2222' });
      const commit2 = makeLoreCommit({ hash: 'bbb', loreId: 'bbbb2222' });

      // First call for initial atoms, second call for findByLoreId
      vi.mocked(gitClient.log).mockResolvedValue([commit1, commit2]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['aaa', []], ['bbb', []]]));

      // Create initial atoms manually with flat structure
      const initialAtoms = [{
        loreId: 'aaaa1111',
        commitHash: 'aaa',
        date: new Date('2025-01-15T10:00:00Z'),
        author: 'dev@example.com',
        intent: 'feat(auth): add login',
        body: '',
        trailers: {
          [LORE_ID_KEY]: ['aaaa1111'],
          Constraint: [],
          Rejected: [],
          Confidence: [],
          'Scope-risk': [],
          Reversibility: [],
          Directive: [],
          Tested: [],
          'Not-tested': [],
          Supersedes: [],
          'Depends-on': [],
          Related: ['bbbb2222'],
        } as any,
        filesChanged: [],
      }];

      const result = await repo.resolveFollowLinks(initialAtoms, 2);

      expect(result).toHaveLength(2);
      const ids = result.map((a) => a.loreId);
      expect(ids).toContain('aaaa1111');
      expect(ids).toContain('bbbb2222');
    });

    it('should return original atoms when maxDepth is 0', async () => {
      const atoms = [{
        loreId: 'aaaa1111',
        commitHash: 'aaa',
        date: new Date(),
        author: 'dev@example.com',
        intent: 'test',
        body: '',
        trailers: {
          [LORE_ID_KEY]: ['aaaa1111'],
          Constraint: [],
          Rejected: [],
          Confidence: [],
          'Scope-risk': [],
          Reversibility: [],
          Directive: [],
          Tested: [],
          'Not-tested': [],
          Supersedes: [],
          'Depends-on': [],
          Related: ['bbbb2222'],
        } as any,
        filesChanged: [],
      }];

      const result = await repo.resolveFollowLinks(atoms, 0);

      expect(result).toHaveLength(1);
      expect(result[0].loreId).toBe('aaaa1111');
    });

    it('should return original atoms when no follow links exist', async () => {
      const atoms = [{
        loreId: 'aaaa1111',
        commitHash: 'aaa',
        date: new Date(),
        author: 'dev@example.com',
        intent: 'test',
        body: '',
        trailers: {
          [LORE_ID_KEY]: ['aaaa1111'],
          Constraint: [],
          Rejected: [],
          Confidence: [],
          'Scope-risk': [],
          Reversibility: [],
          Directive: [],
          Tested: [],
          'Not-tested': [],
          Supersedes: [],
          'Depends-on': [],
          Related: [],
        } as any,
        filesChanged: [],
      }];

      const result = await repo.resolveFollowLinks(atoms, 3);

      expect(result).toHaveLength(1);
    });

    it('should handle circular references without infinite loop', async () => {
      // Atom A references B, Atom B references A
      const commitA = makeLoreCommit({ hash: 'aaa', loreId: 'aaaa1111', trailerExtras: 'Related: bbbb2222' });
      const commitB = makeLoreCommit({ hash: 'bbb', loreId: 'bbbb2222', trailerExtras: 'Related: aaaa1111' });

      vi.mocked(gitClient.log).mockResolvedValue([commitA, commitB]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['aaa', []], ['bbb', []]]));

      const atomA = {
        loreId: 'aaaa1111',
        commitHash: 'aaa',
        date: new Date(),
        author: 'dev@example.com',
        intent: 'test',
        body: '',
        trailers: {
          [LORE_ID_KEY]: ['aaaa1111'],
          Constraint: [],
          Rejected: [],
          Confidence: [],
          'Scope-risk': [],
          Reversibility: [],
          Directive: [],
          Tested: [],
          'Not-tested': [],
          Supersedes: [],
          'Depends-on': [],
          Related: ['bbbb2222'],
        } as any,
        filesChanged: [],
      };

      const result = await repo.resolveFollowLinks([atomA], 5);

      expect(result).toHaveLength(2);
    });

    it('should not exceed maxDepth in transitive resolution', async () => {
      // Chain: A -> B -> C -> D, but maxDepth = 1
      const commitB = makeLoreCommit({ hash: 'bbb', loreId: 'bbbb2222', trailerExtras: 'Related: cccc3333' });
      const commitC = makeLoreCommit({ hash: 'ccc', loreId: 'cccc3333', trailerExtras: 'Related: dddd4444' });
      const commitD = makeLoreCommit({ hash: 'ddd', loreId: 'dddd4444' });

      // findByLoreId will search all commits
      vi.mocked(gitClient.log).mockResolvedValue([commitB, commitC, commitD]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['bbb', []], ['ccc', []], ['ddd', []]]));

      const atomA = {
        loreId: 'aaaa1111',
        commitHash: 'aaa',
        date: new Date(),
        author: 'dev@example.com',
        intent: 'test',
        body: '',
        trailers: {
          [LORE_ID_KEY]: ['aaaa1111'],
          Constraint: [],
          Rejected: [],
          Confidence: [],
          'Scope-risk': [],
          Reversibility: [],
          Directive: [],
          Tested: [],
          'Not-tested': [],
          Supersedes: [],
          'Depends-on': [],
          Related: ['bbbb2222'],
        } as any,
        filesChanged: [],
      };

      const result = await repo.resolveFollowLinks([atomA], 1);

      // Should find A and B only (depth 1), not C or D
      expect(result).toHaveLength(2);
      const ids = result.map((a) => a.loreId);
      expect(ids).toContain('aaaa1111');
      expect(ids).toContain('bbbb2222');
    });

    it('should return empty array for empty input', async () => {
      const result = await repo.resolveFollowLinks([], 3);
      expect(result).toEqual([]);
    });
  });

  describe('git log format', () => {
    it('should pass args to git client log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await repo.findAll();

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(Array.isArray(logArgs)).toBe(true);
    });

    it('should pass pre-resolved git log args including -- separator to git client', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const gitLogArgs = ['--', 'src/auth.ts'];
      await repo.findByTarget(gitLogArgs, makeQueryOptions());

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--');
      expect(logArgs).toContain('src/auth.ts');
    });
  });

  describe('batching behavior', () => {
    it('should call getFilesChanged only for Lore commits, not non-Lore commits', async () => {
      const loreCommit = makeLoreCommit({ hash: 'abc12345', loreId: 'aaaa1111' });
      const nonLoreCommit: RawCommit = {
        hash: 'non-lore',
        date: '2025-01-16T10:00:00Z',
        author: 'dev@example.com',
        subject: 'chore: deps',
        body: '',
        trailers: '',
      };
      vi.mocked(gitClient.log).mockResolvedValue([loreCommit, nonLoreCommit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['abc12345', ['src/auth.ts']]]));

      await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(gitClient.getFilesChanged).toHaveBeenCalledWith(['abc12345']);
    });

    it('should handle many commits in a single batch', async () => {
      const commits = Array.from({ length: 25 }, (_, i) =>
        makeLoreCommit({ hash: `hash${i}`, loreId: `${String(i).padStart(8, '0')}` }),
      );
      vi.mocked(gitClient.log).mockResolvedValue(commits);
      
      const filesMap = new Map<string, string[]>();
      commits.forEach(c => filesMap.set(c.hash, ['file.ts']));
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(filesMap);

      const result = await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(result).toHaveLength(25);
      expect(gitClient.getFilesChanged).toHaveBeenCalledTimes(1);
      expect(vi.mocked(gitClient.getFilesChanged).mock.calls[0][0]).toHaveLength(25);
    });

    it('should propagate getFilesChanged errors', async () => {
      const commit = makeLoreCommit({ loreId: 'deadbeef' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockRejectedValue(new Error('git failed'));

      await expect(repo.findByTarget(makeGitLogArgs(), makeQueryOptions())).rejects.toThrow('git failed');
    });
  });
});
