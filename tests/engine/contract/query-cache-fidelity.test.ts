import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as HydrationLogic from '../../../src/engine/core/logic/hydration.js';
import { createTargetFromIdentities } from '../../../src/engine/core/logic/query-targets.js';
import { QueryCache } from '../../../src/engine/shell/fs/query-cache.js';
import { findAtoms } from '../../../src/engine/shell/orchestrators/discovery.js';
import { 
    makeAtom, 
    makeQueryTarget, 
    makeRawCommit,
    makeStubProtocolContext, 
    makeStubProtocolMap,
    makeStubProtocolState,
    type ProtocolContext,
    ProtocolMap
} from '../../../src/engine/testing.js';
import { type MockedGitClient } from '../../mock-types.js';
import { makeMockGitClient, makeMockInfra } from '../engine-test-utils.js';

describe('Discovery Cache Combined Fidelity (Contract)', () => {
  const testDir = join(tmpdir(), `lore-test-cache-${Math.random().toString(36).slice(2)}`);
  let git: MockedGitClient;
  let protocols: ProtocolMap<ProtocolContext>;
  let cache: QueryCache;

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    git = makeMockGitClient();
    const protocol = makeStubProtocolContext();
    protocols = makeStubProtocolMap([protocol]);
    cache = new QueryCache(testDir, 'test-fingerprint');

  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  const getInfra = () => makeMockInfra({
      git,
      protocols,
      cache
  });

  it('should skip DISCOVERY (query) but perform FETCH (getCommitsByHashes) on cache hit', async () => {
    const headHash = 'a1b2c3d4e5f6'; // Must be valid hex
    const commit = makeRawCommit({ 
      hash: 'abc', 
      id: 'id1', 
      filesChanged: ['src/logic.ts'] 
    });

    vi.mocked(git.resolveRef).mockResolvedValue(headHash);

    const mockAtomState = makeAtom({ 
        commitHash: 'abc', 
        filesChanged: commit.filesChanged,
        protocols: makeStubProtocolMap([['mock', makeStubProtocolState({ trailers: { 'Mock-id': ['id1'] } })]])
    });

    // 1. First run: Perform full Discovery + Fetch
    vi.mocked(git.queryStream).mockImplementation(async function* () { yield* [commit]; });
    vi.spyOn(HydrationLogic, 'hydrateAtoms').mockReturnValue([mockAtomState]);
    vi.spyOn(cache, 'get').mockResolvedValue(null);

    const target = makeQueryTarget('src/logic.ts');
    const infra = getInfra();
    await findAtoms(infra, target, { cache: true });
    expect(git.queryStream).toHaveBeenCalledTimes(1);

    // 2. Second run: Cache should hit (skipping query)
    vi.mocked(git.queryStream).mockClear();
    vi.spyOn(cache, 'get').mockResolvedValue(['abc']);
    vi.mocked(git.getLogStream).mockImplementation(async function* () { yield 'abc\nsrc/logic.ts'; });
    vi.spyOn(HydrationLogic, 'hydrateAtoms').mockReturnValue([mockAtomState]);

    const result = await findAtoms(infra, target, { cache: true });

    // VERIFICATION A: Physical Integrity
    // Discovery is skipped, but FETCH still gets full records (including files)
    expect(result).toHaveLength(1);
    expect(git.queryStream).not.toHaveBeenCalled();
    expect(git.getLogStream).toHaveBeenCalled();
    expect(result[0].filesChanged).toEqual(['src/logic.ts']);

    // VERIFICATION B: Logical Truth
    // 'Smart Atom' projection must still happen even on cache hit
    expect(result[0].protocols.get('mock')?.supersession).toBeDefined();
    expect(result[0].protocols.get('mock')?.supersession?.superseded).toBe(false);
  });

  it('should skip DISCOVERY for identity targets on cache hit', async () => {
    const headHash = 'f1e2d3c4b5a6';
    const id = '12345678'; // Must be valid 8-char hex

    const mockAtomState = makeAtom({ 
        id,
        protocols: makeStubProtocolMap([['mock', makeStubProtocolState({ trailers: { 'Mock-id': [id] } })]])
    });

    vi.mocked(git.resolveRef).mockResolvedValue(headHash);
    vi.mocked(git.getLogStream).mockImplementation(async function* () { yield 'hash123'; });
    vi.spyOn(HydrationLogic, 'hydrateAtoms').mockReturnValue([mockAtomState]);

    const infra = getInfra();

    // 1. Initial run: Fill cache
    vi.spyOn(infra.identityIndex, 'get').mockResolvedValue([]);
    vi.mocked(infra.git.filterAliveHashes).mockResolvedValue([]);
    const target = createTargetFromIdentities([{ protocol: 'mock', id }]);

    await findAtoms(infra, target, { cache: true });
    expect(git.queryStream).toHaveBeenCalledTimes(1);

    // 2. Second run: Cache hit
    vi.mocked(git.queryStream).mockClear();
    vi.spyOn(infra.identityIndex, 'get').mockResolvedValue(['hash123']);
    vi.mocked(infra.git.filterAliveHashes).mockResolvedValue(['hash123']);
    vi.spyOn(HydrationLogic, 'hydrateAtoms').mockReturnValue([mockAtomState]);

    const result = await findAtoms(infra, target, { cache: true });

    // VERIFICATION: Discovery is skipped, but truth projection still happens
    expect(git.queryStream).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].protocols.get('mock')?.supersession).toBeDefined();
  });
});