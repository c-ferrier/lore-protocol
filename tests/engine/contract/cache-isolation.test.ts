import { beforeEach,describe, expect, it, vi } from 'vitest';

import { type IGitClient } from '../../../src/engine/interfaces/git-client.js';
import { type IQueryCache } from '../../../src/engine/interfaces/query-cache.js';
import { makeQueryTarget, makeAtomRepository } from '../../../src/engine/testing.js';
import { makeMockGitClient, makeMockQueryCache } from '../engine-test-utils.js';



;
;

describe('AtomRepository Cache Isolation', () => {
  let gitClient: IGitClient;
  let queryCache: IQueryCache;
  let repo: any;

  beforeEach(() => {
    gitClient = makeMockGitClient();
    queryCache = makeMockQueryCache();

    repo = makeAtomRepository({ gitClient });
    (repo as any).queryCache = queryCache;
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
    const target = makeQueryTarget();
    (target as any).type = 'identity';
    (target as any).identities = [{ id: 'aaaa1111', protocol: 'mock' }];
    (target as any).getCacheFingerprint = () => 'identity:mock/aaaa1111';

    await repo.find(target);
    expect(queryCache.get).toHaveBeenCalledWith('head-hash', 'identity:mock/aaaa1111', expect.any(Object));
  });
});