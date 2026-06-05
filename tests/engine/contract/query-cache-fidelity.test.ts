import { hydrateAtoms } from '../../../src/engine/core/logic/hydration.js';
import { createTargetFromIdentities } from '../../../src/engine/core/logic/query-targets.js';
import { type Atom } from '../../../src/engine/core/types/domain.js';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { QueryCache } from '../../../src/engine/shell/fs/query-cache.js';
import { makeAtom, makeProtocol, makeQueryTarget, makeRawCommit } from '../../../src/engine/testing.js';
import { makeMockGitClient } from '../engine-test-utils.js';

import { describe, it, expect, beforeEach, vi } from 'vitest';
;
;
;
import { rmSync, mkdirSync } from 'node:fs';

;
import * as HydrationLogic from '../../../src/engine/core/logic/hydration.js';

describe('Query Cache Combined Fidelity (Contract)', () => {
  const testDir = '.test-cache-fidelity';
  let gitClient: any;
  let registry: any;
  let cache: QueryCache;
  let repo: AtomRepository;

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    gitClient = makeMockGitClient();
    registry = new ProtocolRegistry();
    registry.register(makeProtocol());
    
    cache = new QueryCache(testDir, 100, 'test-fingerprint');

    repo = new AtomRepository(
      gitClient,
      registry,
      cache,
      makeQueryTarget(),
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
    
    const mockAtomState = makeAtom({ 
        commitHash: 'abc', 
        filesChanged: commit.filesChanged,
        protocols: new Map([['mock', { trailers: { 'Mock-id': ['id1'] }, unauthorized: {} }]]) 
    });

    // 1. First run: Perform full Discovery + Fetch
    vi.mocked(gitClient.query).mockResolvedValue([commit]);
    vi.spyOn(HydrationLogic, 'hydrateAtoms').mockReturnValue([mockAtomState]);
    vi.spyOn(cache, 'get').mockResolvedValue(null);
    
    const target = makeQueryTarget('src/logic.ts');
    await repo.find(target, { cache: true });
    expect(gitClient.query).toHaveBeenCalledTimes(1);

    // 2. Second run: Cache should hit (skipping query)
    vi.mocked(gitClient.query).mockClear();
    vi.spyOn(cache, 'get').mockResolvedValue(['abc']);
    vi.mocked(gitClient.getCommitsByHashes).mockResolvedValue([commit]);
    vi.spyOn(HydrationLogic, 'hydrateAtoms').mockReturnValue([mockAtomState]);
    
    const result = await repo.find(target, { cache: true });
    
    // VERIFICATION A: Physical Integrity
    // Discovery is skipped, but FETCH still gets full records (including files)
    expect(result).toHaveLength(1);
    expect(gitClient.query).not.toHaveBeenCalled();
    expect(gitClient.getCommitsByHashes).toHaveBeenCalledWith(['abc']);
    expect(result[0].filesChanged).toEqual(['src/logic.ts']);
    
    // VERIFICATION B: Logical Truth
    // 'Smart Atom' projection must still happen even on cache hit
    expect(result[0].protocols.get('mock')?.supersession).toBeDefined();
    expect(result[0].protocols.get('mock')?.supersession?.superseded).toBe(false);
  });

  it('should skip DISCOVERY for identity targets on cache hit', async () => {
    const headHash = 'f1e2d3c4b5a6';
    const id = '12345678'; // Must be valid 8-char hex
    const commit = makeRawCommit({ hash: 'hash123', id });

    const mockAtomState = makeAtom({ 
        id,
        protocols: new Map([['mock', { trailers: { 'Mock-id': [id] }, unauthorized: {} }]])
    });

    vi.mocked(gitClient.resolveRef).mockResolvedValue(headHash);
    vi.mocked(gitClient.getCommitsByHashes).mockResolvedValue([commit]);
    vi.spyOn(HydrationLogic, 'hydrateAtoms').mockReturnValue([mockAtomState]);

    // 1. Initial run: Fill cache
    vi.spyOn(cache, 'get').mockResolvedValue(null);
    const target = createTargetFromIdentities([{ id }]);

    await repo.find(target, { cache: true });
    expect(gitClient.query).toHaveBeenCalledTimes(1);

    // 2. Second run: Cache hit
    vi.mocked(gitClient.query).mockClear();
    vi.spyOn(cache, 'get').mockResolvedValue(['hash123']);
    vi.spyOn(HydrationLogic, 'hydrateAtoms').mockReturnValue([mockAtomState]);

    const result = await repo.find(target, { cache: true });

    // VERIFICATION: Discovery is skipped, but truth projection still happens
    expect(gitClient.query).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].protocols.get('mock')?.supersession).toBeDefined();
  });
});