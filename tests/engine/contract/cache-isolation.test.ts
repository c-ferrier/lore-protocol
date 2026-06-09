import { beforeEach,describe, expect, it, vi } from 'vitest';

import { QueryTargetAST } from '../../../src/engine/core/types/query.js';
import { type IGitClient } from '../../../src/engine/interfaces/git-client.js';
import { type IQueryCache } from '../../../src/engine/interfaces/query-cache.js';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { makeAtomRepository,makeQueryTarget } from '../../../src/engine/testing.js';
import { makeMockGitClient, makeMockQueryCache } from '../engine-test-utils.js';

describe('AtomRepository Cache Isolation', () => {
  let gitClient: IGitClient;
  let queryCache: IQueryCache;
  let repo: AtomRepository;

  beforeEach(() => {
    gitClient = makeMockGitClient();
    queryCache = makeMockQueryCache();

    repo = makeAtomRepository({ gitClient, queryCache });
  });

  it('should use "global" key for global find and path: key for targeted find', async () => {
    vi.mocked(gitClient.resolveRef).mockResolvedValue('head-hash');
    await repo.find();
    expect(queryCache.get).toHaveBeenCalledWith('head-hash', 'global', expect.any(Object));

    await repo.find(makeQueryTarget('src/main.ts'));
    expect(queryCache.get).toHaveBeenCalledWith('head-hash', 'path:src/main.ts', expect.any(Object));
  });

  it('search (find with text) should also use "global" key fingerprint', async () => {
    vi.mocked(gitClient.resolveRef).mockResolvedValue('head-hash');
    await repo.find(undefined, { text: 'query' });
    expect(queryCache.get).toHaveBeenCalledWith('head-hash', 'global', expect.objectContaining({ text: 'query' }));
  });

  it('should cache identity queries using unique fingerprints', async () => {
    vi.mocked(gitClient.resolveRef).mockResolvedValue('head-hash');
    
    // Create an identity target for ID 'aaaa1111'
    const target = {
      type: 'identity',
      identities: [{ id: 'aaaa1111', protocol: 'mock' }],
      raw: 'aaaa1111',
      resolvedPaths: [],
      getCacheFingerprint: () => 'identity:mock/aaaa1111'
    } as unknown as QueryTargetAST;

    await repo.find(target);
    expect(queryCache.get).toHaveBeenCalledWith('head-hash', 'identity:mock/aaaa1111', expect.any(Object));
  });
});