import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { 
  makeMockGitClient, 
  makeAtomHydrator,
  makeRawCommit,
  makeAtom,
  makeProtocol,
  makeQueryTarget,
  ProtocolRegistry,
  TEST_ID_KEY
} from '../engine-test-utils.js';
import { QueryCache } from '../../../src/engine/services/query-cache.js';
import { SearchFilter } from '../../../src/engine/services/search-filter.js';
import { PathResolver } from '../../../src/engine/services/path-resolver.js';
import { rmSync, mkdirSync } from 'node:fs';

describe('Query Cache Combined Fidelity (Contract)', () => {
  const testDir = '.test-cache-fidelity';
  let gitClient: any;
  let registry: any;
  let cache: QueryCache;
  let hydrator: any;
  let repo: AtomRepository;

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    gitClient = makeMockGitClient();
    registry = new ProtocolRegistry();
    registry.register(makeProtocol());
    
    cache = new QueryCache(testDir, 100, 'test-fingerprint');
    
    hydrator = {
        hydrate: vi.fn(),
        extractReferenceIds: vi.fn(() => [])
    };

    const searchFilter = new SearchFilter(registry);

    repo = new AtomRepository(
      gitClient,
      hydrator as any,
      registry,
      searchFilter,
      cache,
      makeQueryTarget()
    );
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should skip DISCOVERY (query) but perform FETCH (getCommitsByHashes) on cache hit', async () => {
    const headHash = 'a1b2c3d4e5f6'; // Must be valid hex
    const commit = makeRawCommit({ 
      hash: 'abc', 
      id: 'id1', 
      filesChanged: ['src/logic.ts'] 
    });

    vi.mocked(gitClient.resolveRef).mockResolvedValue(headHash);
    
    // 1. First run: Perform full Discovery + Fetch
    vi.mocked(gitClient.query).mockResolvedValue([commit]);
    vi.mocked(hydrator.hydrate).mockReturnValue([makeAtom({ commitHash: 'abc', filesChanged: commit.filesChanged })]);
    vi.spyOn(cache, 'get').mockResolvedValue(null);
    
    const target = makeQueryTarget('src/logic.ts');
    await repo.find(target, { cache: true });
    expect(gitClient.query).toHaveBeenCalledTimes(1);

    // 2. Second run: Cache should hit (skipping query)
    vi.mocked(gitClient.query).mockClear();
    vi.spyOn(cache, 'get').mockResolvedValue(['abc']);
    vi.mocked(gitClient.getCommitsByHashes).mockResolvedValue([commit]);
    vi.mocked(hydrator.hydrate).mockReturnValue([makeAtom({ commitHash: 'abc', filesChanged: commit.filesChanged })]);
    
    const result = await repo.find(target, { cache: true });
    
    // VERIFICATION: Discovery is skipped
    expect(gitClient.query).not.toHaveBeenCalled();
    
    // VERIFICATION: Fetch is still performed to get the full records (including files)
    expect(gitClient.getCommitsByHashes).toHaveBeenCalledWith(['abc']);
    
    expect(result).toHaveLength(1);
    expect(result[0].filesChanged).toEqual(['src/logic.ts']);
  });
});
