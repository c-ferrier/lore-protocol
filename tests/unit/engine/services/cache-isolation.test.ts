import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IGitClient } from '../../../../src/engine/interfaces/git-client.js';
import type { IQueryCache } from '../../../../src/engine/interfaces/query-cache.js';
import { makeAtomRepository } from '../test-utils.js';
import { GLOBAL_CACHE_KEY } from '../../../../src/engine/util/constants.js';

describe('AtomRepository Cache Isolation', () => {
  let gitClient: IGitClient;
  let queryCache: IQueryCache;
  let repo: any;

  beforeEach(() => {
    gitClient = {
      log: vi.fn(async () => []),
      getCommitsByHashes: vi.fn(async () => []),
      getFilesChanged: vi.fn(async () => new Map()),
      resolveRef: vi.fn(async () => 'head-hash'),
      resolveDate: vi.fn(async (d: string) => new Date(d)),
    } as any;

    queryCache = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
      prune: vi.fn(async () => {}),
    };

    repo = makeAtomRepository({ gitClient });
    (repo as any).queryCache = queryCache;
  });

  it(`should use "${GLOBAL_CACHE_KEY}" key for findAll and path array for findAtoms`, async () => {
    await repo.findAll();
    expect(queryCache.get).toHaveBeenCalledWith('head-hash', [GLOBAL_CACHE_KEY], expect.any(Object));

    await repo.findAtoms(['src/main.ts'], {});
    // PathResolver translates ['src/main.ts'] into ['--', 'src/main.ts']
    expect(queryCache.get).toHaveBeenCalledWith('head-hash', ['--', 'src/main.ts'], expect.any(Object));
  });

  it(`search() should also use "${GLOBAL_CACHE_KEY}" key`, async () => {
    await repo.search({ text: 'query' });
    expect(queryCache.get).toHaveBeenCalledWith('head-hash', [GLOBAL_CACHE_KEY], expect.any(Object));
  });
});
