import { readFile, writeFile, mkdir, readdir, stat, unlink, utimes, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { IQueryCache } from '../interfaces/query-cache.js';
import type { QueryOptions } from '../types/query.js';

const HEX_HASH = /^[0-9a-f]{7,64}$/i;

export class QueryCache implements IQueryCache {
  constructor(private readonly cacheDir: string) {}

  async get(
    headHash: string,
    gitLogArgs: readonly string[],
    options: QueryOptions,
  ): Promise<readonly string[] | null> {
    if (!HEX_HASH.test(headHash)) return null;
    const path = this.getCachePath(headHash, gitLogArgs, options);
    try {
      const content = await readFile(path, 'utf8');

      // Corruption check: empty file or NUL bytes indicate a failed/partial write.
      if (!content || content.includes('\0')) {
        return null;
      }

      // If the file is just whitespace (and not exactly a single newline), it's corrupt.
      // This allows a single newline to represent a valid empty list without a header.
      // Empty lists occur when no commits match the specific query criteria.
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
    gitLogArgs: readonly string[],
    options: QueryOptions,
    hashes: readonly string[],
  ): Promise<void> {
    if (!HEX_HASH.test(headHash)) return;
    const path = this.getCachePath(headHash, gitLogArgs, options);
    await mkdir(dirname(path), { recursive: true });

    const header = {
      head: headHash,
      query: { gitLogArgs, ...options },
      createdAt: new Date().toISOString(),
    };

    // Always ensure a newline so empty lists aren't 0-byte files.
    // Empty lists occur when no commits match the specific query criteria.
    // Atomic write: write to unique temp file then rename to final destination.
    const content = `# ${JSON.stringify(header)}\n${hashes.join('\n')}\n`;
    
    // Using .tmp.${randomUUID()} matches AtomCache pattern
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
      
      // Filter out non-cache files (like .tmp files or .gitignore)
      const cacheFiles = files.filter(f => !f.startsWith('.') && !f.includes('.tmp.'));
      
      if (cacheFiles.length <= 100) return;

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

      const fileStats = stats.filter((s): s is { name: string; atime: number } => s !== null);

      // Sort by atime ascending (oldest first)
      fileStats.sort((a, b) => a.atime - b.atime);

      // Delete oldest files until we are at exactly 100
      const toDelete = fileStats.slice(0, fileStats.length - 100);
      await Promise.all(
        toDelete.map(async (f) => {
          try {
            await unlink(join(this.cacheDir, f.name));
          } catch (e: unknown) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw e;
          }
        })
      );
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  private getCachePath(headHash: string, gitLogArgs: readonly string[], options: QueryOptions): string {
    const queryHash = this.generateQueryHash(gitLogArgs, options);
    const filename = `${headHash}-${queryHash}`;
    return join(this.cacheDir, filename);
  }

  private generateQueryHash(gitLogArgs: readonly string[], options: QueryOptions): string {
    // 1. Normalize gitLogArgs (order matters for git paths, so we don't sort)
    const normalizedArgs = gitLogArgs.join('|');

    // 2. Normalize options (sort keys for stable hashing)
    const sortedOptions = Object.keys(options)
      .sort()
      .reduce((acc: any, key) => {
        // limit and page are display/pagination concerns and should not invalidate the cache
        if (key === 'limit' || key === 'page') return acc;
        
        const val = (options as any)[key];
        if (val !== null && val !== undefined) {
          acc[key] = val;
        }
        return acc;
      }, {});
    
    const normalizedOptions = JSON.stringify(sortedOptions);

    // 3. Hash the combined string
    return createHash('sha1')
      .update(`${normalizedArgs}:${normalizedOptions}`)
      .digest('hex');
  }
}

/**
 * Null Object implementation of IQueryCache.
 * Performs no caching; always returns null and ignores writes.
 */
export class NullQueryCache implements IQueryCache {
  async get(
    _headHash: string,
    _gitLogArgs: readonly string[],
    _options: QueryOptions,
  ): Promise<readonly string[] | null> {
    return null;
  }

  async set(
    _headHash: string,
    _gitLogArgs: readonly string[],
    _options: QueryOptions,
    _hashes: readonly string[],
  ): Promise<void> {
    // No-op
  }

  async prune(): Promise<void> {
    // No-op
  }
}
