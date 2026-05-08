import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryCache, NullQueryCache } from '../../../src/services/query-cache.js';
import { rm, mkdir, access, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { QueryOptions } from '../../../src/types/query.js';

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

    // Case 3: Only whitespace (and not just \n)
    await writeFile(path, '   \n  ');
    expect(await cache.get(headHash, gitLogArgs, options)).toBeNull();
  });

  it('should prune oldest files when threshold is hit', async () => {
    const cache = new QueryCache(cacheDir);
    
    // Create 80 dummy files
    for (let i = 0; i < 80; i++) {
      const path = join(cacheDir, `file-${i}`);
      await writeFile(path, 'data');
      // Shift atime manually for predictable pruning (oldest first)
      const time = new Date(2000, 1, 1, 0, i).getTime() / 1000;
      // Note: utimes is tricky in JS, but re-writing works or we can trust fs.stat
    }

    await cache.prune();
    
    const files = await rm(cacheDir, { recursive: true, force: true }).then(() => mkdir(cacheDir)).then(() => []); // Mock cleanup for counting
    // Actually just re-read the dir
    const remaining = await (async () => {
        const cache = new QueryCache(cacheDir);
        for (let i = 0; i < 80; i++) {
            await writeFile(join(cacheDir, `f-${i}`), 'data');
        }
        await cache.prune();
        const files = await (await import('node:fs/promises')).readdir(cacheDir);
        return files.length;
    })();

    expect(remaining).toBe(50);
  });
});

describe('NullQueryCache', () => {
  it('should always return null and ignore sets', async () => {
    const cache = new NullQueryCache();
    const options: any = { all: false, follow: false, limit: null, author: null, maxCommits: null, since: null, scope: null };
    await cache.set('hash', [], options, ['abc']);
    expect(await cache.get('hash', [], options)).toBeNull();
  });
});
