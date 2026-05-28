import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryCache } from '../../../../src/engine/services/query-cache.js';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { QueryOptions } from '../../../../src/engine/types/query.js';

describe('QueryCache', () => {
  let tempDir: string;
  let cache: QueryCache;
  const F1 = 'mock@1.0';

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'query-cache-test-'));
    cache = new QueryCache(tempDir, 100, F1);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const getMockOptions = (): QueryOptions => ({
    scope: null,
    author: null,
    since: null,
    until: null,
    text: null,
    all: false,
    limit: 10,
    maxCommits: 100,
    confidence: null,
    scopeRisk: null,
    reversibility: null,
    has: null,
  });

  // Valid 40-char hex hashes for testing
  const H1 = 'abc1234567890abcdef1234567890abcdef1234';
  const H2 = 'def1234567890abcdef1234567890abcdef1234';
  const H3 = '9991234567890abcdef1234567890abcdef1234';

  it('should store and retrieve hash lists based on query key', async () => {
    const gitLogArgs = ['--', 'src/auth.ts'];
    const hashes = ['h1', 'h2', 'h3'];
    const options = getMockOptions();

    await cache.set(H1, gitLogArgs, options, hashes);
    const retrieved = await cache.get(H1, gitLogArgs, options);

    expect(retrieved).toEqual(hashes);
  });

  it('should return null if HEAD has changed', async () => {
    const gitLogArgs = ['--', 'src/auth.ts'];
    const options = getMockOptions();
    await cache.set(H1, gitLogArgs, options, ['h1']);

    const retrieved = await cache.get(H2, gitLogArgs, options);
    expect(retrieved).toBeNull();
  });

  it('should distinguish between different git log arguments', async () => {
    const options = getMockOptions();
    await cache.set(H1, ['--a'], options, ['h1']);
    await cache.set(H1, ['--b'], options, ['h2']);

    const r1 = await cache.get(H1, ['--a'], options);
    const r2 = await cache.get(H1, ['--b'], options);

    expect(r1).toEqual(['h1']);
    expect(r2).toEqual(['h2']);
  });

  it('should distinguish between different query options', async () => {
    const args = ['--'];
    const o1 = { ...getMockOptions(), since: '2025-01-01' };
    const o2 = { ...getMockOptions(), since: '2025-02-01' };
    
    await cache.set(H1, args, o1, ['h1']);
    await cache.set(H1, args, o2, ['h2']);

    const r1 = await cache.get(H1, args, o1);
    const r2 = await cache.get(H1, args, o2);

    expect(r1).toEqual(['h1']);
    expect(r2).toEqual(['h2']);
  });

  it('should prune old entries based on LRU threshold', async () => {
    const smallCache = new QueryCache(tempDir, 2, F1);
    const options = getMockOptions();

    await smallCache.set(H1, ['--1'], options, ['v1']);
    await new Promise(r => setTimeout(r, 10)); 
    await smallCache.set(H2, ['--2'], options, ['v2']);
    await new Promise(r => setTimeout(r, 10));
    await smallCache.set(H3, ['--3'], options, ['v3']);

    await smallCache.prune();

    const files = await readdir(tempDir);
    expect(files.length).toBeLessThanOrEqual(2);
  });

  it('should invalidate cache if fingerprint changes', async () => {
    const gitLogArgs = ['--'];
    const hashes = ['h1'];
    const options = getMockOptions();

    await cache.set(H1, gitLogArgs, options, hashes);
    
    const otherCache = new QueryCache(tempDir, 100, 'fred@1.0;mock@1.0');
    const retrieved = await otherCache.get(H1, gitLogArgs, options);

    expect(retrieved).toBeNull();
  });
});
