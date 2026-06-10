import { beforeEach,describe, expect, it, vi } from 'vitest';

import { type IGitClient } from '../../../src/engine/interfaces/git-client.js';
import { type IQueryCache } from '../../../src/engine/interfaces/query-cache.js';
import { findAtoms } from '../../../src/engine/shell/orchestrators/discovery.js';
import { makeQueryTarget } from '../../../src/engine/testing.js';
import { makeMockGitClient, makeMockInfra, makeMockQueryCache } from '../engine-test-utils.js';

describe('Discovery Cache Isolation', () => {
  let git: IGitClient;
  let cache: IQueryCache;

  beforeEach(() => {
    git = makeMockGitClient();
    cache = makeMockQueryCache();
  });

  it('should use "global" key for global find and path: key for targeted find', async () => {
    vi.mocked(git.resolveRef).mockResolvedValue('head-hash');
    const infra = makeMockInfra({ git, cache });

    await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] });
    expect(cache.get).toHaveBeenCalledWith('head-hash', 'global', expect.any(Object));

    await findAtoms(infra, makeQueryTarget('src/main.ts'));
    expect(cache.get).toHaveBeenCalledWith('head-hash', 'path:src/main.ts', expect.any(Object));
  });

  it('search (find with text) should also use "global" key fingerprint', async () => {
    vi.mocked(git.resolveRef).mockResolvedValue('head-hash');
    const infra = makeMockInfra({ git, cache });

    await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] }, { text: 'query' });
    expect(cache.get).toHaveBeenCalledWith('head-hash', 'global', expect.objectContaining({ text: 'query' }));
  });

  it('should cache identity queries using unique fingerprints', async () => {
    vi.mocked(git.resolveRef).mockResolvedValue('head-hash');
    const infra = makeMockInfra({ git, cache });
    
    // Create an identity target for ID 'aaaa1111'
    const target = makeQueryTarget({
      type: 'identity',
      identities: [{ id: 'aaaa1111', protocol: 'mock' }],
      raw: 'aaaa1111'
    });

    await findAtoms(infra, target);
    expect(cache.get).toHaveBeenCalledWith('head-hash', 'identity:mock/aaaa1111', expect.any(Object));
  });
});