import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AtomCache, NullAtomCache } from '../../../../src/engine/services/atom-cache.js';
import { rm, mkdir, access, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

describe('AtomCache', () => {
  const cacheDir = join(process.cwd(), '.atom-test-cache');

  beforeEach(async () => {
    await mkdir(cacheDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('should return null for miss', async () => {
    const cache = new AtomCache(cacheDir);
    expect(await cache.get('abc12345')).toBeNull();
  });

  it('should round-trip files changed', async () => {
    const cache = new AtomCache(cacheDir);
    const entry = { filesChanged: ['src/a.ts', 'src/b.ts'] };
    const hash = 'abc123456789';
    
    await cache.set(hash, entry);
    const result = await cache.get(hash);
    
    expect(result).toEqual(entry);

    // Verify file exists at sharded path
    const shard = hash.substring(0, 2);
    const rest = hash.substring(2);
    const expectedPath = join(cacheDir, shard, rest);
    await expect(access(expectedPath)).resolves.toBeUndefined();
  });

  it('should handle empty file list', async () => {
    const cache = new AtomCache(cacheDir);
    const hash = 'aabbccdd11223344';
    await cache.set(hash, { filesChanged: [] });
    expect(await cache.get(hash)).toEqual({ filesChanged: [] });
  });

  it('should reject invalid hashes', async () => {
    const cache = new AtomCache(cacheDir);
    expect(await cache.get('../../../etc/passwd')).toBeNull();
    expect(await cache.get('not-a-hash!')).toBeNull();
  });

  it('should return null for corrupted cache files', async () => {
    const cache = new AtomCache(cacheDir);
    const hash = 'corrupt123';
    const shard = hash.substring(0, 2);
    const rest = hash.substring(2);
    const path = join(cacheDir, shard, rest);

    await mkdir(dirname(path), { recursive: true });

    // Case 1: NUL bytes
    await writeFile(path, Buffer.from([0, 1, 2, 3]));
    expect(await cache.get(hash)).toBeNull();

    // Case 2: Empty file
    await writeFile(path, '');
    expect(await cache.get(hash)).toBeNull();

    // Case 3: Only whitespace
    await writeFile(path, '   \n  ');
    expect(await cache.get(hash)).toBeNull();
  });

  it('should recover from and overwrite corrupted cache files', async () => {
    const cache = new AtomCache(cacheDir);
    const hash = 'abc12345';
    const shard = hash.substring(0, 2);
    const rest = hash.substring(2);
    const path = join(cacheDir, shard, rest);

    await mkdir(dirname(path), { recursive: true });

    // 1. Create a corrupted file (with NUL bytes)
    await writeFile(path, Buffer.from([0, 0, 0]));
    
    // 2. Verify it's detected as a miss (returns null)
    expect(await cache.get(hash)).toBeNull();

    // 3. Overwrite it with valid data
    const entry = { filesChanged: ['file1.ts', 'file2.ts'] };
    await cache.set(hash, entry);

    // 4. Verify it's now a hit with the correct data
    expect(await cache.get(hash)).toEqual(entry);
  });
});

describe('NullAtomCache', () => {
  it('should always return null and ignore sets', async () => {
    const cache = new NullAtomCache();
    await cache.set('hash', { filesChanged: ['file.txt'] });
    expect(await cache.get('hash')).toBeNull();
  });
});
