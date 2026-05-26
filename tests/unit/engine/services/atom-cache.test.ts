import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AtomCache } from '../../../../src/engine/services/atom-cache.js';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('AtomCache', () => {
  let tempDir: string;
  let cache: AtomCache;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'atom-cache-test-'));
    cache = new AtomCache(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should store and retrieve file lists by commit hash', async () => {
    const hash = 'abc1234567890';
    const data = { filesChanged: ['src/main.ts', 'src/util.ts'] };

    await cache.set(hash, data);
    const retrieved = await cache.get(hash);

    expect(retrieved).toEqual(data);
  });

  it('should return null for missing entries', async () => {
    const retrieved = await cache.get('missing-hash');
    expect(retrieved).toBeNull();
  });

  it('should handle corrupt JSON gracefully', async () => {
    const hash = 'corrupt-hash';
    const shard = hash.slice(0, 2);
    const subDir = join(tempDir, shard);
    await mkdir(subDir, { recursive: true });
    await writeFile(join(subDir, hash), 'invalid-json');

    const retrieved = await cache.get(hash);
    expect(retrieved).toBeNull();
  });

  it('should use 2-character subdirectory shards', async () => {
    const hash = '1234567890';
    const data = { filesChanged: ['f1'] };
    await cache.set(hash, data);

    const shard = '12';
    const rest = '34567890';
    const expectedPath = join(tempDir, shard, rest);
    const content = await readFile(expectedPath, 'utf-8');
    const files = content.trim().split('\n');
    expect(files).toEqual(data.filesChanged);
  });
});
