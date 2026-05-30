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
      resolveDate: vi.fn(async (d: string) => {
        const date = new Date(d);
        return isNaN(date.getTime()) ? null : date;
      }),
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

  it(`should use "${GLOBAL_CACHE_KEY}" key for global find and path array for targeted find`, async () => {
    await repo.find();
    expect(queryCache.get).toHaveBeenCalledWith('head-hash', [GLOBAL_CACHE_KEY], expect.any(Object));

    await repo.find({ target: 'src/main.ts' });
    // PathResolver translates 'src/main.ts' into ['--', 'src/main.ts']
    expect(queryCache.get).toHaveBeenCalledWith('head-hash', ['--', 'src/main.ts'], expect.any(Object));
  });

  it(`search (find with text) should also use "${GLOBAL_CACHE_KEY}" key`, async () => {
    await repo.find({ text: 'query' });
    expect(queryCache.get).toHaveBeenCalledWith('head-hash', [GLOBAL_CACHE_KEY], expect.any(Object));
  });
});
