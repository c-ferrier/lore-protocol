import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IdentityIndex, NullIdentityIndex } from '../../../src/shell/fs/identity-index.js';

describe('IdentityIndex Implementation', () => {
  let tempDir: string;
  let index: IdentityIndex;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'identity-index-test-'));
    index = new IdentityIndex(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should store and retrieve identities', async () => {
    await index.append('lore/abc', 'hash1');
    await index.append('lore/abc', 'hash2');
    await index.append('beta/xyz', 'hash3');

    const abc = await index.get('lore/abc');
    const xyz = await index.get('beta/xyz');

    expect(abc).toEqual(['hash1', 'hash2']);
    expect(xyz).toEqual(['hash3']);
  });

  it('should be case-insensitive for identity keys', async () => {
    await index.append('LORE/ABC', 'hash1');
    const result = await index.get('lore/abc');
    expect(result).toEqual(['hash1']);
  });

  it('should prevent duplicate hash entries for the same ID', async () => {
    await index.append('lore/abc', 'hash1');
    await index.append('lore/abc', 'hash1');
    
    const result = await index.get('lore/abc');
    expect(result).toHaveLength(1);
    expect(result).toEqual(['hash1']);
  });

  it('should persist entries to an append-only log file', async () => {
    await index.append('lore/abc', 'hash1');
    await index.append('beta/def', 'hash2');

    const content = await readFile(join(tempDir, 'index.log'), 'utf8');
    expect(content).toContain('lore/abc hash1');
    expect(content).toContain('beta/def hash2');
  });

  it('should reload state from disk correctly', async () => {
    await index.append('lore/abc', 'hash1');
    
    // Create a new instance pointing to same directory
    const newIndex = new IdentityIndex(tempDir);
    const result = await newIndex.get('lore/abc');
    
    expect(result).toEqual(['hash1']);
  });

  it('should handle missing index file gracefully', async () => {
    const result = await index.get('nonexistent');
    expect(result).toEqual([]);
  });

  it('should clear the index', async () => {
    await index.append('lore/abc', 'hash1');
    await index.clear();
    
    const result = await index.get('lore/abc');
    expect(result).toEqual([]);
  });
});

describe('NullIdentityIndex', () => {
  it('should always return empty array and never store anything', async () => {
    const ni = new NullIdentityIndex();
    await ni.append('any', 'hash');
    const result = await ni.get('any');
    expect(result).toEqual([]);
  });
});
