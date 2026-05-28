import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryCache } from '../../../../src/engine/services/query-cache.js';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

describe('QueryCache Stability', () => {
  const testCacheDir = join(process.cwd(), '.atom', 'test-query-cache');

  beforeEach(async () => {
    await mkdir(testCacheDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testCacheDir, { recursive: true, force: true });
  });

  it('should produce the same hash for filters with different key orders', async () => {
    const cache = new QueryCache(testCacheDir);
    const headHash = 'a'.repeat(40);
    const gitLogArgs = ['GLOBAL'];
    
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
});
