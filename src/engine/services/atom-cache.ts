import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IAtomCache, AtomCacheEntry } from '../interfaces/atom-cache.js';

const HEX_HASH = /^[0-9a-f]{7,64}$/i;

/**
 * File-system based cache for protocol atom metadata (currently changed files).
 * Uses a sharded directory structure (xx/hash) within the configured cache directory.
 *
 * GRASP: Pure Fabrication -- caching is a technical concern decoupled from domain logic.
 */
export class AtomCache implements IAtomCache {
  constructor(private readonly cacheDir: string) {}

  async get(hash: string): Promise<AtomCacheEntry | null> {
    if (!HEX_HASH.test(hash)) return null;
    const path = this.getCachePath(hash);
    try {
      const content = await readFile(path, 'utf8');

      if (!content || content.includes('\0')) return null;
      if (content.trim() === '' && content !== '\n') return null;

      const files = content === '\n' ? [] : content.replace(/\n$/, '').split('\n');
      return { filesChanged: files };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async set(hash: string, entry: AtomCacheEntry): Promise<void> {
    if (!HEX_HASH.test(hash)) return;
    const path = this.getCachePath(hash);
    const tempPath = `${path}.tmp.${randomUUID()}`;

    await mkdir(dirname(path), { recursive: true });

    try {
      await writeFile(tempPath, entry.filesChanged.join('\n') + '\n', 'utf8');
      await rename(tempPath, path);
    } catch (error: unknown) {
      try { await unlink(tempPath); } catch { /* ignore */ }
      throw error;
    }
  }

  private getCachePath(hash: string): string {
    const shard = hash.substring(0, 2);
    const rest = hash.substring(2);
    return join(this.cacheDir, shard, rest);
  }
}

/**
 * Null Object implementation of IAtomCache.
 */
export class NullAtomCache implements IAtomCache {
  async get(_hash: string): Promise<AtomCacheEntry | null> {
    return null;
  }

  async set(_hash: string, _entry: AtomCacheEntry): Promise<void> {
    // No-op
  }
}
