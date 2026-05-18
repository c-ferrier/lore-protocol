import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../src/services/atom-repository.js';
import { SupersessionResolver } from '../../../src/services/supersession-resolver.js';
import type { IGitClient, RawCommit } from '../../../src/interfaces/git-client.js';
import type { QueryOptions } from '../../../src/types/query.js';
import type { LoreTrailers } from '../../../src/types/domain.js';
import type { IAtomCache } from '../../../src/interfaces/atom-cache.js';
import type { IQueryCache } from '../../../src/interfaces/query-cache.js';
import { CustomTrailerCollection } from '../../../src/types/custom-trailer-collection.js';

/**
 * Minimal TrailerParser mock that satisfies the AtomRepository's usage.
 */
function createMockTrailerParser() {
  return {
    containsLoreTrailers: vi.fn((text: string) => text.includes('Lore-id')),
    parse: vi.fn((rawTrailers: string, _customKeys: readonly string[]): LoreTrailers => {
      const trailers = parseTrailersFromText(rawTrailers);
      return trailers;
    }),
    serialize: vi.fn(() => ''),
    extractTrailerBlock: vi.fn(() => ''),
  };
}

function createMockAtomCache(): IAtomCache {
  return {
    getFiles: vi.fn(async () => null),
    setFiles: vi.fn(async () => {}),
  };
}

function createMockQueryCache(): IQueryCache {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    prune: vi.fn(async () => {}),
  };
}

/**
 * Simple trailer text parser for tests.
 * Extracts key: value pairs from a multi-line trailer block.
 */
function parseTrailersFromText(raw: string): LoreTrailers {
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  let loreId = '';
  const constraints: string[] = [];
  const rejected: string[] = [];
  let confidence: LoreTrailers['Confidence'] = null;
  let scopeRisk: LoreTrailers['Scope-risk'] = null;
  let reversibility: LoreTrailers['Reversibility'] = null;
  const directives: string[] = [];
  const tested: string[] = [];
  const notTested: string[] = [];
  const supersedes: string[] = [];
  const dependsOn: string[] = [];
  const related: string[] = [];

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    const value = line.substring(colonIdx + 1).trim();

    switch (key) {
      case 'Lore-id': loreId = value; break;
      case 'Constraint': constraints.push(value); break;
      case 'Rejected': rejected.push(value); break;
      case 'Confidence': confidence = value as LoreTrailers['Confidence']; break;
      case 'Scope-risk': scopeRisk = value as LoreTrailers['Scope-risk']; break;
      case 'Reversibility': reversibility = value as LoreTrailers['Reversibility']; break;
      case 'Directive': directives.push(value); break;
      case 'Tested': tested.push(value); break;
      case 'Not-tested': notTested.push(value); break;
      case 'Supersedes': supersedes.push(value); break;
      case 'Depends-on': dependsOn.push(value); break;
      case 'Related': related.push(value); break;
    }
  }

  return {
    'Lore-id': loreId,
    Constraint: constraints,
    Rejected: rejected,
    Confidence: confidence,
    'Scope-risk': scopeRisk,
    Reversibility: reversibility,
    Directive: directives,
    Tested: tested,
    'Not-tested': notTested,
    Supersedes: supersedes,
    'Depends-on': dependsOn,
    Related: related,
    custom: CustomTrailerCollection.empty(),
  };
}

function createMockGitClient(overrides: Partial<IGitClient> = {}): IGitClient {
  return {
    log: vi.fn(async () => []),
    blame: vi.fn(async () => []),
    commit: vi.fn(async () => ({ hash: 'abc123', success: true })),
    hasStagedChanges: vi.fn(async () => false),
    getRepoRoot: vi.fn(async () => '/repo'),
    getFilesChanged: vi.fn(async () => []),
    countCommitsSince: vi.fn(async () => 0),
    resolveRef: vi.fn(async () => 'abc123'),
    getHeadMessage: vi.fn(async () => ''),
    getCommitsByHashes: vi.fn(async () => []),
    ...overrides,
  };
}

interface LoreCommitOptions {
  hash?: string;
  loreId?: string;
  author?: string;
  subject?: string;
  body?: string;
  trailers?: string;
  trailerExtras?: string;
}

function makeLoreCommit(options: LoreCommitOptions = {}): RawCommit {
  const hash = options.hash ?? 'abc12345';
  const loreId = options.loreId ?? 'a1b2c3d4';
  const trailers = options.trailers ?? `Lore-id: ${loreId}${options.trailerExtras ? '\n' + options.trailerExtras : ''}`;

  return {
    hash,
    date: '2025-01-15T12:00:00Z',
    author: options.author ?? 'dev@example.com',
    subject: options.subject ?? 'feat: add login',
    body: options.body ?? 'Initial implementation.',
    trailers,
  };
}

function makeGitLogArgs(filePath: string = 'src/auth.ts'): readonly string[] {
  return ['--', filePath];
}

function makeQueryOptions(overrides: Partial<QueryOptions> = {}): QueryOptions {
  return {
    scope: null,
    text: null,
    confidence: null,
    scopeRisk: null,
    reversibility: null,
    has: null,
    follow: false,
    followDepth: null,
    all: false,
    author: null,
    limit: null,
    page: null,
    maxCommits: null,
    since: null,
    until: null,
    ...overrides,
  };
}

describe('AtomRepository', () => {
  let gitClient: IGitClient;
  let trailerParser: ReturnType<typeof createMockTrailerParser>;
  let supersessionResolver: SupersessionResolver;
  let atomCache: IAtomCache;
  let queryCache: IQueryCache;
  let repo: AtomRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    gitClient = createMockGitClient();
    trailerParser = createMockTrailerParser();
    supersessionResolver = new SupersessionResolver();
    atomCache = createMockAtomCache();
    queryCache = createMockQueryCache();
    repo = new AtomRepository(
      gitClient,
      trailerParser as any,
      supersessionResolver,
      atomCache,
      queryCache,
    );
  });

  describe('findByTarget', () => {
    it('should return atoms for a file target', async () => {
      const commit = makeLoreCommit();
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['src/auth.ts']);

      const gitLogArgs = makeGitLogArgs();
      const options = makeQueryOptions();
      const result = await repo.findByTarget(gitLogArgs, options);

      expect(result.atoms).toHaveLength(1);
      expect(result.atoms[0].loreId).toBe('a1b2c3d4');
      expect(result.atoms[0].commitHash).toBe('abc12345');
      expect(result.atoms[0].author).toBe('dev@example.com');
      expect(result.atoms[0].filesChanged).toEqual(['src/auth.ts']);
    });

    it('should filter out non-Lore commits', async () => {
      const commit1 = makeLoreCommit();
      const commit2 = {
        hash: '67890',
        date: '2025-01-15T12:00:00Z',
        author: 'dev@example.com',
        subject: 'chore: regular commit',
        body: 'No lore here.',
        trailers: '',
      };
      vi.mocked(gitClient.log).mockResolvedValue([commit1, commit2]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['src/auth.ts']);

      const result = await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(result.atoms).toHaveLength(1);
      expect(result.atoms[0].loreId).toBe('a1b2c3d4');
    });

    it('should pass author filter to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const options = makeQueryOptions({ author: 'alice' });

      await repo.findByTarget(makeGitLogArgs(), options);

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--author=alice');
    });

    it('should pass since filter to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const options = makeQueryOptions({ since: '2025-01-01' });

      await repo.findByTarget(makeGitLogArgs(), options);

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--since=2025-01-01');
    });

    it('should return empty result when no Lore commits found', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const result = await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(result.atoms).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('should include dependencies from different authors when using --follow', async () => {
      // Scenario:
      // A (author: alice, target) -> Depends-on: B
      // B (author: bob)
      // When querying with --author=alice --follow, we expect both A and B.

      const commitA = makeLoreCommit({ hash: 'aaaa', author: 'alice@example.com', loreId: '11111111', subject: 'feat: a', trailerExtras: 'Depends-on: 22222222' });
      const commitB = makeLoreCommit({ hash: 'bbbb', author: 'bob@example.com', loreId: '22222222', subject: 'feat: b' });

      // Discovery phase (Git log) only returns Alice's commit
      vi.mocked(gitClient.log).mockImplementation(async (args) => {
        if (args.includes('--author=alice')) return [commitA];
        if (args.includes('--grep=Lore-id: 22222222')) return [commitB];
        return [];
      });
      vi.mocked(gitClient.resolveRef).mockResolvedValue('a'.repeat(40));

      const options = makeQueryOptions({ author: 'alice', follow: true });
      const result = await repo.findByTarget(['file.ts'], options);

      // Should contain both A and B
      expect(result.atoms).toHaveLength(2);
      const authors = result.atoms.map(a => a.author);
      expect(authors).toContain('alice@example.com');
      expect(authors).toContain('bob@example.com');
    });

    it('should not apply limit at the repository level (caller responsibility)', async () => {
      const commit1 = makeLoreCommit({ hash: 'aaa', loreId: 'aaaa1111' });
      const commit2 = makeLoreCommit({ hash: 'bbb', loreId: 'bbbb2222' });
      const commit3 = makeLoreCommit({ hash: 'ccc', loreId: 'cccc3333' });
      vi.mocked(gitClient.log).mockResolvedValue([commit1, commit2, commit3]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['src/auth.ts']);

      const options = makeQueryOptions({ limit: 2 });
      const result = await repo.findByTarget(makeGitLogArgs(), options);

      // Note: As of the pagination update, AtomRepository DOES handle limit/page.
      // So this test needs to be updated to reflect that it SHOULD apply limit.
      expect(result.atoms).toHaveLength(2);
      expect(result.totalCount).toBe(3);
    });
  });

  describe('findAll', () => {
    it('should retrieve all atoms when no filters provided', async () => {
      const commit1 = makeLoreCommit({ hash: 'aaa', loreId: 'aaaa1111' });
      const commit2 = makeLoreCommit({ hash: 'bbb', loreId: 'bbbb2222' });
      vi.mocked(gitClient.log).mockResolvedValue([commit1, commit2]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['src/auth.ts']);

      const result = await repo.findAll();

      expect(result.atoms).toHaveLength(2);
      expect(result.totalCount).toBe(2);
    });

    it('should strip trailers from body when body is exactly the trailer block', async () => {
      const trailers = 'Lore-id: a1b2c3d4\nConfidence: high';
      const commit = makeLoreCommit({ body: trailers, trailers });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['src/auth.ts']);

      const result = await repo.findAll();

      expect(result.atoms).toHaveLength(1);
      expect(result.atoms[0].body).toBe('');
    });

    it('should pass since option to git log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await repo.findAll({ since: '2025-01-01' });

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--since=2025-01-01');
    });

    it('should pass maxCommits option to git log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await repo.findAll({ maxCommits: 100 });

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--max-count=100');
    });

    it('should return empty result set if history scan fails', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const result = await repo.findAll();

      expect(result.atoms).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });

  describe('findByScope', () => {
    it('should return atoms matching a conventional commit scope', async () => {
      const commit1 = makeLoreCommit({ subject: 'feat(auth): add login', loreId: 'aaaa1111' });
      const commit2 = makeLoreCommit({ subject: 'feat(payments): add charge', loreId: 'bbbb2222' });
      vi.mocked(gitClient.log).mockResolvedValue([commit1, commit2]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['src/auth.ts']);

      const result = await repo.findByScope('auth', makeQueryOptions());

      expect(result.atoms).toHaveLength(1);
      expect(result.atoms[0].loreId).toBe('aaaa1111');
    });

    it('should match scope case-insensitively', async () => {
      const commit = makeLoreCommit({ subject: 'feat(AUTH): add login' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['src/auth.ts']);

      const result = await repo.findByScope('auth', makeQueryOptions());

      expect(result.atoms).toHaveLength(1);
    });

    it('should return empty array when no scope matches', async () => {
      const commit = makeLoreCommit({ subject: 'feat(auth): add login' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['src/auth.ts']);

      const result = await repo.findByScope('payments', makeQueryOptions());

      expect(result.atoms).toEqual([]);
    });

    it('should handle commits without scope in subject', async () => {
      const commit = makeLoreCommit({ subject: 'feat: add login' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['src/auth.ts']);

      const result = await repo.findByScope('auth', makeQueryOptions());

      expect(result.atoms).toEqual([]);
    });
  });

  describe('findByLoreId', () => {
    it('should find a single atom by its ID', async () => {
      const commit = makeLoreCommit({ loreId: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['file.ts']);

      const result = await repo.findByLoreId('aaaa1111');

      expect(result?.loreId).toBe('aaaa1111');
      expect(gitClient.log).toHaveBeenCalledWith(['--all', '--grep=Lore-id: aaaa1111']);
    });

    it('should return null if ID not found', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const result = await repo.findByLoreId('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null for invalid ID format', async () => {
      const result = await repo.findByLoreId('too-short');
      expect(result).toBeNull();
      expect(gitClient.log).not.toHaveBeenCalled();
    });
  });

  describe('findByCommitHash', () => {
    it('should find an atom by its hash', async () => {
      const commit = makeLoreCommit({ hash: 'deadbeef' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['file.ts']);

      const result = await repo.findByCommitHash('deadbeef');

      expect(result?.commitHash).toBe('deadbeef');
      expect(gitClient.log).toHaveBeenCalledWith(['-1', 'deadbeef']);
    });

    it('should return null if hash does not point to a Lore atom', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const result = await repo.findByCommitHash('67890');

      expect(result).toBeNull();
    });
  });

  describe('resolveFollowLinks', () => {
    it('should resolve transitive dependencies', async () => {
      const atomA = { hash: 'aaaa', loreId: '11111111', date: new Date(), trailers: { 'Lore-id': '11111111', 'Depends-on': ['22222222'], Related: [], Supersedes: [], custom: CustomTrailerCollection.empty() } } as any;
      const atomB = { hash: 'bbbb', loreId: '22222222', date: new Date(), trailers: { 'Lore-id': '22222222', 'Depends-on': [], Related: ['33333333'], Supersedes: [], custom: CustomTrailerCollection.empty() } } as any;
      const atomC = { hash: 'cccc', loreId: '33333333', date: new Date(), trailers: { 'Lore-id': '33333333', 'Depends-on': [], Related: [], Supersedes: [], custom: CustomTrailerCollection.empty() } } as any;

      // Mock findByLoreId for recursive resolution
      vi.spyOn(repo, 'findByLoreId').mockImplementation(async (id) => {
        if (id === '22222222') return atomB;
        if (id === '33333333') return atomC;
        return null;
      });

      const result = await repo.resolveFollowLinks([atomA], 5);

      expect(result).toHaveLength(3);
      const ids = result.map(a => a.loreId);
      expect(ids).toContain('11111111');
      expect(ids).toContain('22222222');
      expect(ids).toContain('33333333');
    });

    it('should respect maxDepth', async () => {
      const atomA = { hash: 'aaaa', loreId: '11111111', date: new Date(), trailers: { 'Lore-id': '11111111', 'Depends-on': ['22222222'], Related: [], Supersedes: [], custom: CustomTrailerCollection.empty() } } as any;
      const atomB = { hash: 'bbbb', loreId: '22222222', date: new Date(), trailers: { 'Lore-id': '22222222', 'Depends-on': ['33333333'], Related: [], Supersedes: [], custom: CustomTrailerCollection.empty() } } as any;

      vi.spyOn(repo, 'findByLoreId').mockResolvedValue(atomB);

      const result = await repo.resolveFollowLinks([atomA], 1);

      expect(result).toHaveLength(2); // A and its depth-1 link B
      expect(repo.findByLoreId).toHaveBeenCalledTimes(1);
    });

    it('should handle cycles gracefully', async () => {
      const atomA = { hash: 'aaaa', loreId: '11111111', date: new Date(), trailers: { 'Lore-id': '11111111', 'Depends-on': ['22222222'], Related: [], Supersedes: [], custom: CustomTrailerCollection.empty() } } as any;
      const atomB = { hash: 'bbbb', loreId: '22222222', date: new Date(), trailers: { 'Lore-id': '22222222', 'Depends-on': ['11111111'], Related: [], Supersedes: [], custom: CustomTrailerCollection.empty() } } as any;

      vi.spyOn(repo, 'findByLoreId').mockResolvedValue(atomB);

      const result = await repo.resolveFollowLinks([atomA], 5);

      expect(result).toHaveLength(2);
    });
  });

  describe('Integration: AtomCache', () => {
    it('should use and update cache', async () => {
      const commit = makeLoreCommit({ hash: 'abc', loreId: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(atomCache.getFiles).mockResolvedValue(null);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['file.ts']);

      await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(atomCache.getFiles).toHaveBeenCalledWith('abc');
      expect(gitClient.getFilesChanged).toHaveBeenCalledWith('abc');
      expect(atomCache.setFiles).toHaveBeenCalledWith('abc', ['file.ts']);
    });

    it('should return cached files without calling git when cache hits', async () => {
      const commit = makeLoreCommit({ hash: 'abc', loreId: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(atomCache.getFiles).mockResolvedValue(['cached.ts']);

      const result = await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(result.atoms[0].filesChanged).toEqual(['cached.ts']);
      expect(gitClient.getFilesChanged).not.toHaveBeenCalled();
    });

    it('should handle large batches of file lookups', async () => {
      const commits = Array.from({ length: 25 }, (_, i) => makeLoreCommit({ 
        hash: `h${i.toString().padStart(7, '0')}`, 
        loreId: `${i.toString(16).padStart(8, '0')}` 
      }));
      vi.mocked(gitClient.log).mockResolvedValue(commits);
      vi.mocked(atomCache.getFiles).mockResolvedValue(null);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['file.ts']);

      const result = await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(result.atoms).toHaveLength(25);
      expect(gitClient.getFilesChanged).toHaveBeenCalledTimes(25);
    });

    it('should use QueryCache and bypass discovery when cache hits', async () => {
      const cachedHashes = ['hash1', 'hash2'];
      const commits = [
        makeLoreCommit({ hash: 'hash1', loreId: '11111111' }),
        makeLoreCommit({ hash: 'hash2', loreId: '22222222' }),
      ];

      vi.mocked(gitClient.resolveRef).mockResolvedValue('a'.repeat(40));
      vi.mocked(queryCache.get).mockResolvedValue(cachedHashes);
      vi.mocked(gitClient.getCommitsByHashes).mockResolvedValue(commits);

      const result = await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(result.atoms).toHaveLength(2);
      expect(result.atoms[0].commitHash).toBe('hash1');
      expect(result.atoms[1].commitHash).toBe('hash2');

      // Verify discovery was bypassed
      expect(gitClient.log).not.toHaveBeenCalled();
      expect(queryCache.get).toHaveBeenCalledWith('a'.repeat(40), makeGitLogArgs(), makeQueryOptions());
      expect(gitClient.getCommitsByHashes).toHaveBeenCalledWith(cachedHashes);
    });

    it('should update QueryCache on discovery miss', async () => {
      const commit = makeLoreCommit({ hash: 'abc', loreId: '33333333' });
      vi.mocked(gitClient.resolveRef).mockResolvedValue('a'.repeat(40));
      vi.mocked(queryCache.get).mockResolvedValue(null);
      vi.mocked(gitClient.log).mockResolvedValue([commit]);

      await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(queryCache.set).toHaveBeenCalledWith(
        'a'.repeat(40),
        makeGitLogArgs(),
        makeQueryOptions(),
        ['abc']
      );
    });

    it('should batch hydration from QueryCache', async () => {
      // Create 450 hashes to trigger 3 batches (batch size is 200)
      const hashes = Array.from({ length: 450 }, (_, i) => `h${i.toString().padStart(7, '0')}`);
      vi.mocked(gitClient.resolveRef).mockResolvedValue('a'.repeat(40));
      vi.mocked(queryCache.get).mockResolvedValue(hashes);
      vi.mocked(gitClient.getCommitsByHashes).mockResolvedValue([]);

      await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      // 1 call for bounds + 3 calls for batches (200, 200, 50)
      expect(gitClient.getCommitsByHashes).toHaveBeenCalledTimes(4);
      expect(gitClient.getCommitsByHashes).toHaveBeenNthCalledWith(1, [hashes[0], hashes[449]]);
      expect(gitClient.getCommitsByHashes).toHaveBeenNthCalledWith(2, hashes.slice(0, 200));
      expect(gitClient.getCommitsByHashes).toHaveBeenNthCalledWith(3, hashes.slice(200, 400));
      expect(gitClient.getCommitsByHashes).toHaveBeenNthCalledWith(4, hashes.slice(400));
    });

    it('should apply paging to hydrated results', async () => {
      const cachedHashes = Array.from({ length: 10 }, (_, i) => `abc${i.toString().padStart(5, '0')}`);
      const commits = cachedHashes.map((h, i) => makeLoreCommit({ hash: h, loreId: `${i.toString(16).padStart(8, '0')}` }));

      vi.mocked(gitClient.resolveRef).mockResolvedValue('a'.repeat(40));
      vi.mocked(queryCache.get).mockResolvedValue(cachedHashes);
      // Mock hydration returning all requested hashes (repository handles slicing)
      vi.mocked(gitClient.getCommitsByHashes).mockImplementation(async (hashes) => {
        return commits.filter(c => hashes.includes(c.hash));
      });

      const options = makeQueryOptions({ limit: 3, page: 2 });
      const result = await repo.findByTarget(makeGitLogArgs(), options);

      expect(result.atoms).toHaveLength(3);
      expect(result.totalCount).toBe(10);
      expect(result.atoms[0].commitHash).toBe(cachedHashes[3]);
      expect(result.atoms[2].commitHash).toBe(cachedHashes[5]);

      // Verify only the required slice was hydrated
      expect(gitClient.getCommitsByHashes).toHaveBeenCalledWith(cachedHashes.slice(3, 6));
    });

    it('should filter out superseded atoms even if they were pulled in via follow', async () => {
      // Scenario:
      // A (target, active) -> Depends-on: B
      // B (superseded by C)
      // C (active)
      // If we query for A with --follow, B should be pulled in but then filtered out because C exists in the set.

      const commitA = makeLoreCommit({ hash: 'aaaa', loreId: '11111111', subject: 'feat: a', trailerExtras: 'Depends-on: 22222222' });
      const commitB = makeLoreCommit({ hash: 'bbbb', loreId: '22222222', subject: 'feat: b' });
      const commitC = makeLoreCommit({ hash: 'cccc', loreId: '33333333', subject: 'feat: c', trailerExtras: 'Supersedes: 22222222' });

      vi.mocked(gitClient.log).mockResolvedValue([commitA, commitC]); // Only discovery finds A and C
      vi.mocked(gitClient.resolveRef).mockResolvedValue('a'.repeat(40));
      
      // When findByLoreId is called for follow logic
      vi.mocked(gitClient.log).mockImplementation(async (args) => {
        if (args.includes('--grep=Lore-id: 22222222')) return [commitB];
        return [commitA, commitC];
      });

      const options = makeQueryOptions({ follow: true });
      const result = await repo.findByTarget(['file.ts'], options);

      // Should contain A and C, but NOT B (because B is superseded by C)
      expect(result.atoms).toHaveLength(2);
      const ids = result.atoms.map(a => a.loreId);
      expect(ids).toContain('11111111'); // A
      expect(ids).toContain('33333333'); // C
      expect(ids).not.toContain('22222222'); // B
    });
  });
});
