import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryCache } from '../../../../src/engine/services/query-cache.js';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { GLOBAL_CACHE_KEY } from '../../../../src/engine/util/constants.js';

describe('QueryCache Stability', () => {
  const testCacheDir = join(process.cwd(), '.atom', 'test-query-cache');

  beforeEach(async () => {
    await mkdir(testCacheDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testCacheDir, { recursive: true, force: true });
  });

  it('should produce the same hash for filters with different key orders', async () => {
    const cache = new QueryCache(testCacheDir, 100, 'mock@1.0');
    const headHash = 'a'.repeat(40);
    const gitLogArgs = [GLOBAL_CACHE_KEY];
    
    const options1 = {
      filters: {
        A: 'val1',
        B: 'val2'
      }
    };
    
    const options2 = {
      filters: {
        B: 'val2',
        A: 'val1'
      }
    };

    const hashes = ['h1', 'h2'];
    
    // Set with options1
    await cache.set(headHash, gitLogArgs, options1, hashes);
    
    // Get with options2 (should hit the same cache file)
    const result = await cache.get(headHash, gitLogArgs, options2);
    
    expect(result).toEqual(hashes);
  });

  it('should produce different hashes (cache miss) when the fingerprint changes', async () => {
    const headHash = 'a'.repeat(40);
    const gitLogArgs = [GLOBAL_CACHE_KEY];
    const options = { text: 'bug' };
    const hashes = ['h1'];

    // 1. Set with fingerprint V1
    const cacheV1 = new QueryCache(testCacheDir, 100, 'mock@1.0');
    await cacheV1.set(headHash, gitLogArgs, options, hashes);

    // 2. Get with fingerprint V2 (should MISS)
    const cacheV2 = new QueryCache(testCacheDir, 100, 'mock@1.0;fred@1.0');
    const result = await cacheV2.get(headHash, gitLogArgs, options);

    expect(result).toBeNull();
  });

  it('should be order-independent for gitLogArgs (paths after --)', async () => {
    const cache = new QueryCache(testCacheDir, 100, 'mock@1.0');
    const headHash = 'a'.repeat(40);
    const options = { all: true };
    const hashes = ['h1'];

    await cache.set(headHash, ['--', 'src/auth.ts', 'src/main.ts'], options, hashes);
    const result = await cache.get(headHash, ['--', 'src/main.ts', 'src/auth.ts'], options);

    expect(result).toEqual(hashes);
  });

  it('should be case-insensitive for filter keys', async () => {
    const cache = new QueryCache(testCacheDir, 100, 'mock@1.0');
    const headHash = 'a'.repeat(40);
    const gitLogArgs = [GLOBAL_CACHE_KEY];
    const hashes = ['h1'];

    await cache.set(headHash, gitLogArgs, { filters: { Confidence: 'high' } }, hashes);
    const result = await cache.get(headHash, gitLogArgs, { filters: { confidence: 'high' } });

    expect(result).toEqual(hashes);
  });

  it('should be order-independent for multiple filter values (arrays)', async () => {
    const cache = new QueryCache(testCacheDir, 100, 'mock@1.0');
    const headHash = 'a'.repeat(40);
    const gitLogArgs = [GLOBAL_CACHE_KEY];
    const hashes = ['h1'];

    await cache.set(headHash, gitLogArgs, { filters: { Status: ['open', 'done'] } }, hashes);
    const result = await cache.get(headHash, gitLogArgs, { filters: { status: ['done', 'open'] } });

    expect(result).toEqual(hashes);
  });
});
