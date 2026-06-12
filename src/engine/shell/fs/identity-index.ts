import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { IIdentityIndex } from '../../interfaces/identity-index.js';

/**
 * Filesystem implementation of the Identity Index.
 * Stores mappings in an append-only log file: `[QualifiedID] [Hash]`.
 * 
 * Performance: 
 * - get() parses the file into a Map (cached in-memory for the instance lifetime).
 * - append() writes to the file and updates the memory map.
 */
export class IdentityIndex implements IIdentityIndex {
  private readonly indexPath: string;
  private cache: Map<string, string[]> | null = null;

  constructor(cacheDir: string) {
    this.indexPath = join(cacheDir, 'index.log');
  }

  async get(qualifiedId: string): Promise<string[]> {
    const map = await this.ensureCache();
    return map.get(qualifiedId.toLowerCase()) || [];
  }

  async append(qualifiedId: string, hash: string): Promise<void> {
    const map = await this.ensureCache();
    const id = qualifiedId.toLowerCase();
    
    const existing = map.get(id) || [];
    if (existing.includes(hash)) return;

    // 1. Update Memory
    map.set(id, [...existing, hash]);

    // 2. Persist to Disk (Append only)
    await mkdir(dirname(this.indexPath), { recursive: true });
    
    // We use a safe append pattern
    const line = `${id} ${hash}\n`;
    await writeFile(this.indexPath, line, { flag: 'a' });
  }

  async clear(): Promise<void> {
      this.cache = new Map();
      try {
          await unlink(this.indexPath);
      } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
  }

  private async ensureCache(): Promise<Map<string, string[]>> {
    if (this.cache) return this.cache;

    const map = new Map<string, string[]>();
    try {
      const content = await readFile(this.indexPath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const [id, hash] = trimmed.split(/\s+/);
        if (id && hash) {
          const existing = map.get(id) || [];
          if (!existing.includes(hash)) {
            existing.push(hash);
            map.set(id, existing);
          }
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }

    this.cache = map;
    return map;
  }
}

/**
 * Null Object implementation of IIdentityIndex.
 * Silent no-op for all operations.
 */
export class NullIdentityIndex implements IIdentityIndex {
    async get(): Promise<string[]> { return []; }
    async append(): Promise<void> { }
    async clear(): Promise<void> { }
}
