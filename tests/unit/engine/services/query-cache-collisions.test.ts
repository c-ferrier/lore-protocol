import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryCache } from '../../../../src/engine/services/query-cache.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SearchOptions } from '../../../../src/engine/types/query.js';
import { GLOBAL_CACHE_KEY } from '../../../../src/engine/util/constants.js';

describe('QueryCache Collision Prevention', () => {
  let tempDir: string;
  let cache: QueryCache;
  const F1 = 'mock@1.0';
  const HEAD = 'a'.repeat(40);

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'query-cache-collision-test-'));
    cache = new QueryCache(tempDir, 100, F1);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const getBaseOptions = (): SearchOptions => ({
    scope: null, author: null, since: null, until: null, text: null,
    all: false, limit: null, maxCommits: null, has: null, follow: false,
  });

  it('should distinguish between different search text', async () => {
    const o1 = { ...getBaseOptions(), text: 'bug' };
    const o2 = { ...getBaseOptions(), text: 'feat' };
    
    await cache.set(HEAD, [GLOBAL_CACHE_KEY], o1, ['h1']);
    await cache.set(HEAD, [GLOBAL_CACHE_KEY], o2, ['h2']);

    expect(await cache.get(HEAD, [GLOBAL_CACHE_KEY], o1)).toEqual(['h1']);
    expect(await cache.get(HEAD, [GLOBAL_CACHE_KEY], o2)).toEqual(['h2']);
  });

  it('should distinguish between different "has" trailer filters', async () => {
    const o1 = { ...getBaseOptions(), has: 'Constraint' };
    const o2 = { ...getBaseOptions(), has: 'Directive' };
    
    await cache.set(HEAD, [GLOBAL_CACHE_KEY], o1, ['h1']);
    await cache.set(HEAD, [GLOBAL_CACHE_KEY], o2, ['h2']);

    expect(await cache.get(HEAD, [GLOBAL_CACHE_KEY], o1)).toEqual(['h1']);
    expect(await cache.get(HEAD, [GLOBAL_CACHE_KEY], o2)).toEqual(['h2']);
  });

  it('should distinguish between different authors', async () => {
    const o1 = { ...getBaseOptions(), author: 'alice@ex.com' };
    const o2 = { ...getBaseOptions(), author: 'bob@ex.com' };
    
    await cache.set(HEAD, [GLOBAL_CACHE_KEY], o1, ['h1']);
    await cache.set(HEAD, [GLOBAL_CACHE_KEY], o2, ['h2']);

    expect(await cache.get(HEAD, [GLOBAL_CACHE_KEY], o1)).toEqual(['h1']);
    expect(await cache.get(HEAD, [GLOBAL_CACHE_KEY], o2)).toEqual(['h2']);
  });

  it('should distinguish between --all and active-only queries', async () => {
    const o1 = { ...getBaseOptions(), all: true };
    const o2 = { ...getBaseOptions(), all: false };
    
    await cache.set(HEAD, [GLOBAL_CACHE_KEY], o1, ['h1', 'h2']); // includes superseded
    await cache.set(HEAD, [GLOBAL_CACHE_KEY], o2, ['h1']);       // active only

    expect(await cache.get(HEAD, [GLOBAL_CACHE_KEY], o1)).toEqual(['h1', 'h2']);
    expect(await cache.get(HEAD, [GLOBAL_CACHE_KEY], o2)).toEqual(['h1']);
  });

  it('should distinguish between different maxCommits values', async () => {
    const o1 = { ...getBaseOptions(), maxCommits: 10 };
    const o2 = { ...getBaseOptions(), maxCommits: 100 };
    
    await cache.set(HEAD, [GLOBAL_CACHE_KEY], o1, ['h1']);
    await cache.set(HEAD, [GLOBAL_CACHE_KEY], o2, ['h1', 'h2']);

    expect(await cache.get(HEAD, [GLOBAL_CACHE_KEY], o1)).toEqual(['h1']);
    expect(await cache.get(HEAD, [GLOBAL_CACHE_KEY], o2)).toEqual(['h1', 'h2']);
  });

  it('should handle complex mixed filters without collision', async () => {
      const o1 = { ...getBaseOptions(), text: 'bug', author: 'alice' };
      const o2 = { ...getBaseOptions(), text: 'bug', author: 'bob' };

      await cache.set(HEAD, [GLOBAL_CACHE_KEY], o1, ['h1']);
      await cache.set(HEAD, [GLOBAL_CACHE_KEY], o2, ['h2']);

      expect(await cache.get(HEAD, [GLOBAL_CACHE_KEY], o1)).toEqual(['h1']);
      expect(await cache.get(HEAD, [GLOBAL_CACHE_KEY], o2)).toEqual(['h2']);
  });
});
