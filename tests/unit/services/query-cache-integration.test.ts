import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AtomRepository } from '../../../src/services/atom-repository.js';
import { QueryCache, NullQueryCache } from '../../../src/services/query-cache.js';
import { SupersessionResolver } from '../../../src/services/supersession-resolver.js';
import { TrailerParser } from '../../../src/services/trailer-parser.js';
import { NullAtomCache } from '../../../src/services/atom-cache.js';
import type { IGitClient, RawCommit } from '../../../src/interfaces/git-client.js';
import type { QueryOptions } from '../../../src/types/query.js';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

describe('Query Cache Integration (On/Off Parity)', () => {
  const cacheDir = join(process.cwd(), '.lore-test-integration-cache');
  let gitClient: IGitClient;
  let repo: AtomRepository;
  let queryCache: QueryCache;

  const commit1: RawCommit = {
    hash: 'a'.repeat(40),
    date: '2026-01-01T10:00:00Z',
    author: 'Alice',
    subject: 'feat: one',
    body: 'context',
    trailers: 'Lore-id: 11111111',
  };
  const commit2: RawCommit = {
    hash: 'b'.repeat(40),
    date: '2026-01-01T11:00:00Z',
    author: 'Bob',
    subject: 'feat: two',
    body: 'context',
    trailers: 'Lore-id: 22222222',
  };

  const allCommits = [commit1, commit2];

  beforeEach(async () => {
    await mkdir(cacheDir, { recursive: true });
    
    gitClient = {
      log: vi.fn(async () => allCommits),
      resolveRef: vi.fn(async () => 'a'.repeat(40)),
      getCommitsByHashes: vi.fn(async (hashes: string[]) => 
        // Mock must preserve the order of input hashes, like --no-walk=unsorted
        hashes.map(h => allCommits.find(c => c.hash === h)!)
      ),
      getFilesChanged: vi.fn(async () => ['file.ts']),
    } as any;

    queryCache = new QueryCache(cacheDir);
    repo = new AtomRepository(
      gitClient,
      new TrailerParser(),
      new SupersessionResolver(),
      new NullAtomCache(),
      queryCache
    );
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  const queryOptions: Partial<QueryOptions> = {
    all: true,
    limit: 10
  };

  it('should maintain parity between Cache Miss and Cache Hit', async () => {
    // 1. First run: Cache Miss (Discovery)
    const result1 = await repo.findAll(queryOptions);
    expect(gitClient.log).toHaveBeenCalledTimes(1);
    expect(gitClient.getCommitsByHashes).not.toHaveBeenCalled();
    expect(result1.atoms).toHaveLength(2);
    // Commits are sorted by date descending: commit2 (11:00) comes before commit1 (10:00)
    expect(result1.atoms[0].loreId).toBe('22222222');

    // 2. Second run: Cache Hit (Hydration)
    const result2 = await repo.findAll(queryOptions);
    expect(gitClient.log).toHaveBeenCalledTimes(1); // Still 1 total
    // Called 2 times: once for bounds (newest/oldest) and once for the slice.
    expect(gitClient.getCommitsByHashes).toHaveBeenCalledTimes(2); 
    
    // 3. Comparison: Results must be identical
    expect(result2.atoms).toEqual(result1.atoms);
    expect(result2.totalCount).toBe(result1.totalCount);
  });

  it('should maintain parity when caching is OFF (NullQueryCache)', async () => {
    const offRepo = new AtomRepository(
      gitClient,
      new TrailerParser(),
      new SupersessionResolver(),
      new NullAtomCache(),
      new NullQueryCache()
    );

    const resultOff = await offRepo.findAll(queryOptions);
    const resultOn = await repo.findAll(queryOptions); // This will hit the cache if we ran it before, but repo was re-init in beforeEach
    
    expect(resultOff.atoms).toEqual(resultOn.atoms);
    expect(resultOff.totalCount).toBe(resultOn.totalCount);
  });

  it('should maintain parity across different pagination parameters (Widening)', async () => {
    // 1. Initial run with limit 1
    const resultL1 = await repo.findAll({ ...queryOptions, limit: 1 });
    expect(resultL1.atoms).toHaveLength(1);
    expect(resultL1.totalCount).toBe(2);

    // 2. Widening run with limit 2 (should hit same cache)
    const resultL2 = await repo.findAll({ ...queryOptions, limit: 2 });
    expect(gitClient.log).toHaveBeenCalledTimes(1); // Only initial call
    // Called 2 times: once for bounds, once for slice
    expect(gitClient.getCommitsByHashes).toHaveBeenCalledTimes(2); 
    
    expect(resultL2.atoms).toHaveLength(2);
    expect(resultL2.atoms[0]).toEqual(resultL1.atoms[0]);
    expect(resultL2.totalCount).toBe(2);
  });

  it('should maintain parity with --page navigation', async () => {
    // 1. Get Page 1
    const page1 = await repo.findAll({ ...queryOptions, limit: 1, page: 1 });
    // 2. Get Page 2
    const page2 = await repo.findAll({ ...queryOptions, limit: 1, page: 2 });
    
    expect(gitClient.log).toHaveBeenCalledTimes(1); // Only for Page 1 miss
    // Called 2 times for page 2 hit: once for bounds, once for slice
    expect(gitClient.getCommitsByHashes).toHaveBeenCalledTimes(2); 
    
    expect(page1.atoms).toHaveLength(1);
    expect(page2.atoms).toHaveLength(1);
    expect(page1.atoms[0].loreId).toBe('22222222');
    expect(page2.atoms[0].loreId).toBe('11111111');
    
    // 3. Combined results should match unpaginated run
    const all = await repo.findAll({ ...queryOptions, limit: 10 });
    expect([...page1.atoms, ...page2.atoms]).toEqual(all.atoms);
  });

  it('should invalidate cache when HEAD changes', async () => {
    await repo.findAll(queryOptions); // Miss
    expect(gitClient.log).toHaveBeenCalledTimes(1);

    // Change HEAD
    vi.mocked(gitClient.resolveRef).mockResolvedValue('b'.repeat(40));
    
    await repo.findAll(queryOptions); // Should be another Miss
    expect(gitClient.log).toHaveBeenCalledTimes(2);
  });

  it('should distinguish between different narrowing filters', async () => {
    // 1. Run with Alice filter
    await repo.findAll({ ...queryOptions, author: 'Alice' });
    expect(gitClient.log).toHaveBeenCalledTimes(1);

    // 2. Run with Bob filter (different key)
    await repo.findAll({ ...queryOptions, author: 'Bob' });
    expect(gitClient.log).toHaveBeenCalledTimes(2);

    // 3. Repeat Alice (Hit)
    await repo.findAll({ ...queryOptions, author: 'Alice' });
    expect(gitClient.log).toHaveBeenCalledTimes(2); // Still 2
    expect(gitClient.getCommitsByHashes).toHaveBeenCalledTimes(2);
  });
});
