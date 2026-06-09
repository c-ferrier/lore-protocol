import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename,stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';

import type { QueryOptions } from '../../core/types/query.js';
import type { IQueryCache } from '../../interfaces/query-cache.js';
import { DEFAULT_CACHE_PRUNE_THRESHOLD } from '../../util/constants.js';

const HEX_HASH = /^[0-9a-f]{7,64}$/i;

/**
 * File-system based cache for discovery query results.
 * Caches lists of commit hashes for specific queries (target + options) at a specific HEAD.
 * Uses file access times (atime) to support LRU pruning.
 * 
 * NOTE: This cache is strictly bound to Git architecture. It will silently drop 
 * reads/writes if the provided `headHash` is not a valid hexadecimal string 
 * (e.g. during mock testing with 'head-123').
 */
export class QueryCache implements IQueryCache {
  constructor(
    private readonly cacheDir: string,
    private readonly pruneThreshold: number = DEFAULT_CACHE_PRUNE_THRESHOLD,
    private readonly protocolFingerprint: string = '',
  ) {}

  async get(
    headHash: string,
    targetFingerprint: string,
    options: QueryOptions,
  ): Promise<readonly string[] | null> {
    if (!HEX_HASH.test(headHash)) return null;
    const path = this.getCachePath(headHash, targetFingerprint, options);
    try {
      const content = await readFile(path, 'utf8');

      // Corruption check: empty file or NUL bytes indicate a failed/partial write.
      if (!content || content.includes('\0')) {
        return null;
      }

      // If the file is just whitespace (and not exactly a single newline), it's corrupt.
      // This allows a single newline to represent a valid empty list without a header.
      if (content.trim() === '' && content !== '\n') {
        return null;
      }
      
      // Update atime to support LRU pruning
      const now = new Date();
      try {
        await utimes(path, now, now);
      } catch {
        // Ignore utimes failures (e.g. read-only filesystem)
      }

      const lines = content.replace(/\n$/, '').split('\n');
      
      // Skip the metadata header if it exists (starts with #)
      const startIndex = lines[0]?.startsWith('#') ? 1 : 0;
      const hashes = lines.slice(startIndex).filter(line => line.trim().length > 0);
      
      return hashes;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async set(
    headHash: string,
    targetFingerprint: string,
    options: QueryOptions,
    hashes: readonly string[],
  ): Promise<void> {
    if (!HEX_HASH.test(headHash)) return;
    const path = this.getCachePath(headHash, targetFingerprint, options);
    await mkdir(dirname(path), { recursive: true });

    const header = {
      head: headHash,
      query: { targetFingerprint, ...options },
      protocolFingerprint: this.protocolFingerprint,
      createdAt: new Date().toISOString(),
    };

    // Always ensure a newline so empty lists aren't 0-byte files.
    const content = `# ${JSON.stringify(header)}\n${hashes.join('\n')}\n`;
    
    const tempPath = `${path}.tmp.${randomUUID()}`;
    try {
      await writeFile(tempPath, content, 'utf8');
      await rename(tempPath, path);
    } catch (error: unknown) {
      try {
        await unlink(tempPath);
      } catch {
        // Ignore unlink errors
      }
      throw error;
    }
  }

  async prune(): Promise<void> {
    try {
      const files = await readdir(this.cacheDir);
      
      // Filter out non-cache files
      const cacheFiles = files.filter(f => !f.startsWith('.') && !f.includes('.tmp.'));
      
      if (cacheFiles.length <= this.pruneThreshold) return;

      // Get stats for all files to find oldest by access time
      const stats = await Promise.all(
        cacheFiles.map(async (name) => {
          const path = join(this.cacheDir, name);
          try {
            const s = await stat(path);
            return { name, atime: s.atimeMs };
          } catch (e: unknown) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw e;
          }
        }),
      );

      const validStats = stats.filter((s): s is { name: string; atime: number } => s !== null);
      
      // Sort by atime ascending (oldest first)
      validStats.sort((a, b) => a.atime - b.atime);

      // Delete until we are under the threshold
      const toDelete = validStats.slice(0, validStats.length - this.pruneThreshold);
      
      await Promise.all(
        toDelete.map(s => unlink(join(this.cacheDir, s.name)).catch(() => {})),
      );
    } catch (error: unknown) {
      // Don't let prune failures crash the app
      console.warn(`Query cache prune failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getCachePath(headHash: string, targetFingerprint: string, options: QueryOptions): string {
    const queryHash = this.generateQueryHash(targetFingerprint, options);
    return join(this.cacheDir, `${headHash}-${queryHash}`);
  }

  private generateQueryHash(targetFingerprint: string, options: QueryOptions): string {
    // 1. Target identity is already normalized by the query target logic
    
    // 2. Deep normalize options (sort all keys recursively and lowercase them for stable hashing)
    const normalize = (obj: unknown): unknown => {
      if (Array.isArray(obj)) {
        // Sort arrays of primitives to ensure order-independence for multiple filter values
        const items = obj.map(normalize);
        if (items.every(item => typeof item === 'string' || typeof item === 'number')) {
            return (items as (string | number)[]).sort();
        }
        return items;
      }
      if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
        const record = obj as Record<string, unknown>;
        return Object.keys(record)
          .sort()
          .reduce((acc: Record<string, unknown>, key) => {
            // limit and page are display concerns and should not invalidate the cache
            if (key === 'limit' || key === 'page') return acc;
            
            const val = record[key];
            if (val !== null && val !== undefined) {
              // Lowercase keys to match case-insensitive trailer search behavior
              acc[key.toLowerCase()] = normalize(val);
            }
            return acc;
          }, {});
      }
      return obj;
    };

    const normalizedOptions = JSON.stringify(normalize(options));
    const finalString = `${targetFingerprint}:${normalizedOptions}:${this.protocolFingerprint}`;
    
    const hash = createHash('sha1')
      .update(finalString)
      .digest('hex');
      
    return hash;
  }
}

/**
 * Null Object implementation of IQueryCache.
 * Performs no caching; always returns null and ignores writes.
 */
export class NullQueryCache implements IQueryCache {
  async get(
    _headHash: string,
    _targetFingerprint: string,
    _options: QueryOptions,
  ): Promise<readonly string[] | null> {
    return null;
  }

  async set(
    _headHash: string,
    _targetFingerprint: string,
    _options: QueryOptions,
    _hashes: readonly string[],
  ): Promise<void> {
    // No-op
  }

  async prune(): Promise<void> {
    // No-op
  }
}
