import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryCache, NullQueryCache } from '../../../../src/engine/services/query-cache.js';
import { rm, mkdir, access, writeFile, stat, utimes, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { QueryOptions } from '../../../../src/engine/types/query.js';

describe('QueryCache', () => {
  const cacheDir = join(process.cwd(), '.lore-test-query-cache');
  const headHash = '35fa645c35fa645c35fa645c35fa645c35fa645c';
  const gitLogArgs = ['src/'];
  const options: QueryOptions = {
    all: false,
    follow: true,
    limit: 20,
    page: null,
    author: 'cole',
    maxCommits: 100,
    since: '2026-01-01',
    until: null,
    scope: null,
    text: null,
    confidence: null,
    scopeRisk: null,
    reversibility: null,
    has: null,
  };

  beforeEach(async () => {
    await mkdir(cacheDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('should return null for miss', async () => {
    const cache = new QueryCache(cacheDir);
    expect(await cache.get(headHash, gitLogArgs, options)).toBeNull();
  });

  it('should round-trip hashes with metadata header', async () => {
    const cache = new QueryCache(cacheDir);
    const hashes = ['a'.repeat(40), 'b'.repeat(40)];
    
    await cache.set(headHash, gitLogArgs, options, hashes);
    const result = await cache.get(headHash, gitLogArgs, options);
    
    expect(result).toEqual(hashes);
  });

  it('should be stable regardless of option key order', async () => {
    const cache = new QueryCache(cacheDir);
    const options1 = { all: true, author: 'a' } as any;
    const options2 = { author: 'a', all: true } as any;
    const hashes = ['c'.repeat(40)];

    await cache.set(headHash, gitLogArgs, options1, hashes);
    const result = await cache.get(headHash, gitLogArgs, options2);
    
    expect(result).toEqual(hashes);
  });

  it('should exclude limit and page from query hash', async () => {
    const cache = new QueryCache(cacheDir);
    const options1 = { ...options, limit: 10, page: 1 };
    const options2 = { ...options, limit: 50, page: 5 };
    const hashes = ['f'.repeat(40)];

    await cache.set(headHash, gitLogArgs, options1, hashes);
    const result = await cache.get(headHash, gitLogArgs, options2);
    
    expect(result).toEqual(hashes);
  });

  it('should handle headerless files for backward compatibility', async () => {
    const cache = new QueryCache(cacheDir);
    const hashes = ['d'.repeat(40), 'e'.repeat(40)];
    
    // Manual write without # header
    const queryHash = (cache as any).generateQueryHash(gitLogArgs, options);
    const path = join(cacheDir, `${headHash}-${queryHash}`);
    await writeFile(path, hashes.join('\n'), 'utf8');

    const result = await cache.get(headHash, gitLogArgs, options);
    expect(result).toEqual(hashes);
  });

  it('should handle headerless empty results (single newline)', async () => {
    const cache = new QueryCache(cacheDir);
    
    // Manual write of single newline (valid headerless empty result)
    const queryHash = (cache as any).generateQueryHash(gitLogArgs, options);
    const path = join(cacheDir, `${headHash}-${queryHash}`);
    await writeFile(path, '\n', 'utf8');

    const result = await cache.get(headHash, gitLogArgs, options);
    expect(result).toEqual([]);
  });

  it('should return null for corrupted query cache files', async () => {
    const cache = new QueryCache(cacheDir);
    const queryHash = (cache as any).generateQueryHash(gitLogArgs, options);
    const path = join(cacheDir, `${headHash}-${queryHash}`);

    await mkdir(dirname(path), { recursive: true });

    // Case 1: NUL bytes
    await writeFile(path, Buffer.from([0, 1, 2, 3]));
    expect(await cache.get(headHash, gitLogArgs, options)).toBeNull();

    // Case 2: Empty file
    await writeFile(path, '');
    expect(await cache.get(headHash, gitLogArgs, options)).toBeNull();

    // Case 3: Only whitespace (non-headerless sentinel)
    await writeFile(path, '   \n  ');
    expect(await cache.get(headHash, gitLogArgs, options)).toBeNull();
  });

  it('should prune old entries using LRU (atime)', async () => {
    // Prune threshold of 2
    const cache = new QueryCache(cacheDir, 2);
    
    // 1. Set 3 entries with valid 40-char hashes
    const h1 = '1'.repeat(40);
    const h2 = '2'.repeat(40);
    const h3 = '3'.repeat(40);

    await cache.set(h1, ['arg1'], options, ['a1']);
    await cache.set(h2, ['arg2'], options, ['a2']);
    await cache.set(h3, ['arg3'], options, ['a3']);

    // 2. Find the actual files created
    const files = await readdir(cacheDir);
    expect(files).toHaveLength(3);

    // Map files to their full paths
    const paths = files.map(f => join(cacheDir, f));
    
    // Sort paths to have stable identifiers for the test
    paths.sort();
    const [p1, p2, p3] = paths;

    // 3. Mock atime to differentiate them
    const now = Date.now();
    // Set p1 as oldest, p2 medium, p3 newest
    await utimes(p1, new Date(now - 3000), new Date(now - 3000));
    await utimes(p2, new Date(now - 2000), new Date(now - 2000));
    await utimes(p3, new Date(now - 1000), new Date(now - 1000));

    // 4. Prune
    await cache.prune();

    // 5. Verify p1 (oldest) is gone, others remain
    await expect(access(p1)).rejects.toThrow();
    await expect(access(p2)).resolves.toBeUndefined();
    await expect(access(p3)).resolves.toBeUndefined();
  });
});

describe('NullQueryCache', () => {
  it('should always return null and ignore sets', async () => {
    const cache = new NullQueryCache();
    const headHash = 'abc';
    await cache.set(headHash, [], {} as any, ['hash']);
    expect(await cache.get(headHash, [], {} as any)).toBeNull();
  });
});
