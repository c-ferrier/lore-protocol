import { mkdtemp, readdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { QueryOptions } from '../../../../src/engine/core/types/query.js';
import { runCli } from '../../../../src/engine/index-impl.js';
import { QueryCache } from '../../../../src/engine/shell/fs/query-cache.js';
import {
    TEST_ENGINE_CONFIG, 
    TEST_ENGINE_DIR, 
    TEST_PROTOCOL_DEFINITION, 
} from '../../../../src/engine/testing.js';
import { ENGINE_CONFIG_FILENAME, GLOBAL_CACHE_KEY } from '../../../../src/engine/util/constants.js';
import { makeMockPrompt } from '../../engine-test-utils.js';

describe('QueryCache Implementation', () => {
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
    filters: {},
    has: null,
  });

  const getBaseOptions = (): QueryOptions => ({
    scope: null, author: null, since: null, until: null, text: null,
    all: false, limit: null, maxCommits: null, has: null, follow: false,
    filters: {},
  });

  // Valid 40-char hex hashes for testing
  const H1 = 'abc1234567890abcdef1234567890abcdef1234';
  const H2 = 'def1234567890abcdef1234567890abcdef1234';

  describe('Basic CRUD', () => {
    it('should store and retrieve hash lists based on query key', async () => {
      const gitLogArgs = ['--', 'src/auth.ts'];
      const hashes = ['h1', 'h2', 'h3'];
      const options = getMockOptions();

      await cache.set(H1, gitLogArgs.join(' '), options, hashes);
      const retrieved = await cache.get(H1, gitLogArgs.join(' '), options);

      expect(retrieved).toEqual(hashes);
    });

    it('should return null if HEAD has changed', async () => {
      const gitLogArgs = ['--', 'src/auth.ts'];
      const options = getMockOptions();
      await cache.set(H1, gitLogArgs.join(' '), options, ['h1']);

      const retrieved = await cache.get(H2, gitLogArgs.join(' '), options);
      expect(retrieved).toBeNull();
    });

    it('should distinguish between different git log arguments', async () => {
      const options = getMockOptions();
      await cache.set(H1, '--a', options, ['h1']);
      await cache.set(H1, '--b', options, ['h2']);

      const r1 = await cache.get(H1, '--a', options);
      const r2 = await cache.get(H1, '--b', options);

      expect(r1).toEqual(['h1']);
      expect(r2).toEqual(['h2']);
    });

    it('should distinguish between different query options', async () => {
      const args = ['--'];
      const o1 = { ...getMockOptions(), since: '2025-01-01' };
      const o2 = { ...getMockOptions(), since: '2025-02-01' };
      
      await cache.set(H1, args.join(' '), o1, ['h1']);
      await cache.set(H1, args.join(' '), o2, ['h2']);
  
      const r1 = await cache.get(H1, args.join(' '), o1);
      const r2 = await cache.get(H1, args.join(' '), o2);
  
      expect(r1).toEqual(['h1']);
      expect(r2).toEqual(['h2']);
    });

    it('should prune old entries based on LRU threshold', async () => {
        const smallCache = new QueryCache(tempDir, 2, F1);
        const options = getMockOptions();
        const H3 = '9991234567890abcdef1234567890abcdef1234';
    
        await smallCache.set(H1, ['--1'].join(' '), options, ['v1']);
        await new Promise(r => setTimeout(r, 10)); 
        await smallCache.set(H2, ['--2'].join(' '), options, ['v2']);
        await new Promise(r => setTimeout(r, 10));
        await smallCache.set(H3, ['--3'].join(' '), options, ['v3']);
    
        await smallCache.prune();
    
        const files = await readdir(tempDir);
        expect(files.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Collision Prevention', () => {
    it('should distinguish between different search text', async () => {
      const o1 = { ...getBaseOptions(), text: 'bug' };
      const o2 = { ...getBaseOptions(), text: 'feat' };
      
      await cache.set(H1, GLOBAL_CACHE_KEY, o1, ['h1']);
      await cache.set(H1, GLOBAL_CACHE_KEY, o2, ['h2']);

      expect(await cache.get(H1, GLOBAL_CACHE_KEY, o1)).toEqual(['h1']);
      expect(await cache.get(H1, GLOBAL_CACHE_KEY, o2)).toEqual(['h2']);
    });

    it('should distinguish between different "has" trailer filters', async () => {
      const o1 = { ...getBaseOptions(), has: 'Constraint' };
      const o2 = { ...getBaseOptions(), has: 'Directive' };
      
      await cache.set(H1, GLOBAL_CACHE_KEY, o1, ['h1']);
      await cache.set(H1, GLOBAL_CACHE_KEY, o2, ['h2']);

      expect(await cache.get(H1, GLOBAL_CACHE_KEY, o1)).toEqual(['h1']);
      expect(await cache.get(H1, GLOBAL_CACHE_KEY, o2)).toEqual(['h2']);
    });

    it('should distinguish between different authors', async () => {
        const o1 = { ...getBaseOptions(), author: 'alice@ex.com' };
        const o2 = { ...getBaseOptions(), author: 'bob@ex.com' };
        
        await cache.set(H1, GLOBAL_CACHE_KEY, o1, ['h1']);
        await cache.set(H1, GLOBAL_CACHE_KEY, o2, ['h2']);
    
        expect(await cache.get(H1, GLOBAL_CACHE_KEY, o1)).toEqual(['h1']);
        expect(await cache.get(H1, GLOBAL_CACHE_KEY, o2)).toEqual(['h2']);
    });

    it('should distinguish between --all and active-only queries', async () => {
        const o1 = { ...getBaseOptions(), all: true };
        const o2 = { ...getBaseOptions(), all: false };
        
        await cache.set(H1, GLOBAL_CACHE_KEY, o1, ['h1', 'h2']); // includes superseded
        await cache.set(H1, GLOBAL_CACHE_KEY, o2, ['h1']);       // active only
    
        expect(await cache.get(H1, GLOBAL_CACHE_KEY, o1)).toEqual(['h1', 'h2']);
        expect(await cache.get(H1, GLOBAL_CACHE_KEY, o2)).toEqual(['h1']);
    });

    it('should distinguish between different maxCommits values', async () => {
        const o1 = { ...getBaseOptions(), maxCommits: 10 };
        const o2 = { ...getBaseOptions(), maxCommits: 100 };
        
        await cache.set(H1, GLOBAL_CACHE_KEY, o1, ['h1']);
        await cache.set(H1, GLOBAL_CACHE_KEY, o2, ['h1', 'h2']);
    
        expect(await cache.get(H1, GLOBAL_CACHE_KEY, o1)).toEqual(['h1']);
        expect(await cache.get(H1, GLOBAL_CACHE_KEY, o2)).toEqual(['h1', 'h2']);
    });

    it('should handle complex mixed filters without collision', async () => {
        const o1 = { ...getBaseOptions(), text: 'bug', author: 'alice' };
        const o2 = { ...getBaseOptions(), text: 'bug', author: 'bob' };

        await cache.set(H1, GLOBAL_CACHE_KEY, o1, ['h1']);
        await cache.set(H1, GLOBAL_CACHE_KEY, o2, ['h2']);

        expect(await cache.get(H1, GLOBAL_CACHE_KEY, o1)).toEqual(['h1']);
        expect(await cache.get(H1, GLOBAL_CACHE_KEY, o2)).toEqual(['h2']);
    });
  });

  describe('Stability & Fingerprinting', () => {
    it('should produce the same hash for filters with different key orders', async () => {
      const options1 = { filters: { A: 'val1', B: 'val2' } };
      const options2 = { filters: { B: 'val2', A: 'val1' } };
      const hashes = ['h1', 'h2'];
      
      await cache.set(H1, 'global', options1, hashes);
      expect(await cache.get(H1, 'global', options2)).toEqual(hashes);
    });

    it('should invalidate cache if fingerprint changes', async () => {
      await cache.set(H1, '--', getMockOptions(), ['h1']);
      
      const otherCache = new QueryCache(tempDir, 100, 'v2-fingerprint');
      expect(await otherCache.get(H1, ['--'].join(' '), getMockOptions())).toBeNull();
    });

    it('should be case-insensitive for filter keys', async () => {
        const headHash = 'a'.repeat(40);
        const target = 'global';
        const hashes = ['h1'];
    
        await cache.set(headHash, target, { filters: { Confidence: 'high' } }, hashes);
        const result = await cache.get(headHash, target, { filters: { confidence: 'high' } });
    
        expect(result).toEqual(hashes);
    });

    it('should be order-independent for multiple filter values (arrays)', async () => {
        const headHash = 'a'.repeat(40);
        const target = 'global';
        const hashes = ['h1'];
    
        await cache.set(headHash, target, { filters: { Status: ['open', 'done'] } }, hashes);
        const result = await cache.get(headHash, target, { filters: { status: ['done', 'open'] } });
    
        expect(result).toEqual(hashes);
    });

    it('should be order-independent for path fingerprints', async () => {
        const headHash = 'a'.repeat(40);
        const options = { all: true };
        const hashes = ['h1'];
    
        const fingerprint = 'path:src/auth.ts,src/main.ts';
        
        await cache.set(headHash, fingerprint, options, hashes);
        const result = await cache.get(headHash, fingerprint, options);
    
        expect(result).toEqual(hashes);
    });

    it('should be independent of presentation options (color, format, etc.)', async () => {
        const headHash = 'a'.repeat(40);
        const target = 'global';
        const hashes = ['h1'];
        
        // Base options
        const o1 = { ...getBaseOptions(), color: true, format: 'text', json: false };
        // Changed presentation options
        const o2 = { ...getBaseOptions(), color: false, format: 'json', json: true };
    
        await cache.set(headHash, target, o1, hashes);
        const result = await cache.get(headHash, target, o2);
    
        expect(result).toEqual(hashes);
    });
  });
});

describe('Cache Bypass Integration (--no-cache)', () => {
  let integrationTempDir: string;

  beforeAll(async () => {
    integrationTempDir = await mkdtemp(join(tmpdir(), 'query-cache-bypass-'));
  });

  afterAll(async () => {
    await rm(integrationTempDir, { recursive: true, force: true });
  });

  it('should verify the infrastructure is created when running a command', async () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'atom', 'log', '--no-cache'];
    
    const { infra } = await runCli({
      binaryName: 'atom', version: '0.0.0-test',
      description: 'Agnostic',
      engineDirName: TEST_ENGINE_DIR,
      configFileName: ENGINE_CONFIG_FILENAME,
      defaultConfig: TEST_ENGINE_CONFIG,
      staticProtocols: [TEST_PROTOCOL_DEFINITION],
      prompt: makeMockPrompt(),
    });

    expect(infra.git).toBeDefined();
    process.argv = originalArgv;
  });
});
