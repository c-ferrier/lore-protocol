import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { AtomRepository } from '../../src/engine/services/atom-repository.js';
import { GitClient } from '../../src/engine/services/git-client.js';
import { TrailerParser } from '../../src/engine/services/trailer-parser.js';
import { Protocol } from '../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../src/engine/services/protocol-registry.js';
import { SearchFilter } from '../../src/engine/services/search-filter.js';
import { PathResolver } from '../../src/engine/services/path-resolver.js';
import { NullAtomCache } from '../../src/engine/services/atom-cache.js';
import { NullQueryCache } from '../../src/engine/services/query-cache.js';
import { LoreProtocolDefinition } from '../../src/lore/protocol-definition.js';

describe('AtomRepository Git Integration', () => {
  let testDir: string;
  let gitClient: GitClient;
  let repo: AtomRepository;

  beforeAll(() => {
    testDir = join(process.cwd(), 'temp-git-discovery-test-unified');
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    const run = (cmd: string) => execSync(cmd, { cwd: testDir, stdio: 'pipe' });

    run('git init');
    run('git config user.name "Test User"');
    run('git config user.email "test@example.com"');

    // 1. Valid Lore Atom
    writeFileSync(join(testDir, 'file1.txt'), 'content1');
    run('git add .');
    run('git commit -m "feat(auth): login feature\n\nLore-id: 00000001\nConfidence: high"');
    
    // Add delay to ensure distinct timestamps for --since tests
    run('sleep 1.1');

    // 2. Another Valid Lore Atom (different scope/author)
    run('git config user.name "Other User"');
    writeFileSync(join(testDir, 'file2.txt'), 'content2');
    run('git add .');
    run('git commit -m "fix(ui): layout\n\nLore-id: 00000002\nConfidence: low"');

    // 3. Non-Lore Commit (Should be filtered by discovery mode)
    run('sleep 1.1');
    writeFileSync(join(testDir, 'file3.txt'), 'content3');
    run('git add .');
    run('git commit -m "chore: just a cleanup"');

    // 4. Commit with Fake Lore ID (should be filtered if validation fails)
    run('sleep 1.1');
    writeFileSync(join(testDir, 'file4.txt'), 'content4');
    run('git add .');
    run('git commit -m "feat: fake\n\nLore-id: NOT-A-HEX-ID"');
  });

  beforeEach(() => {
    gitClient = new GitClient(testDir);
    const trailerParser = new TrailerParser();
    const protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(new Protocol(LoreProtocolDefinition));
    const searchFilter = new SearchFilter(protocolRegistry);
    const pathResolver = new PathResolver(testDir, testDir);
    const atomCache = new NullAtomCache();
    const queryCache = new NullQueryCache();

    repo = new AtomRepository(
      gitClient,
      trailerParser,
      protocolRegistry,
      searchFilter,
      pathResolver,
      atomCache,
      queryCache
    );
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('Discovery Mode: should only return commits with valid Lore-id trailers', async () => {
    const result = await repo.find();
    // Should find #1 and #2, but not #3 (chore) or #4 (fake trailer)
    expect(result).toHaveLength(2);
    const ids = result.map(a => a.protocols.get('lore')?.trailers['Lore-id']?.[0]);
    expect(ids).toContain('00000001');
    expect(ids).toContain('00000002');
  });

  it('Coarse Filtering: should correctly filter by author at Git level', async () => {
    const result = await repo.find({ author: 'test@example.com' });
    expect(result).toHaveLength(2); // Both lore atoms have same email
  });

  it('Coarse Filtering: should correctly filter by scope at Git level', async () => {
    const result = await repo.find({ scope: 'auth' });
    expect(result).toHaveLength(1);
    expect(result[0].protocols.get('lore')?.trailers['Lore-id']?.[0]).toBe('00000001');
  });

  it('Coarse Filtering: should handle AND logic (all-match) at Git level', async () => {
    // Author: Other User AND scope: ui
    const result = await repo.find({ author: 'Other User', scope: 'ui' });
    expect(result).toHaveLength(1);
    expect(result[0].protocols.get('lore')?.trailers['Lore-id']?.[0]).toBe('00000002');
  });

  it('Coarse Filtering: should handle date-based filtering (since/until)', async () => {
    // Find atom #2 by using a date slightly newer than atom #1
    const all = await repo.find();
    const since = new Date(all[1].date.getTime() + 1).toISOString(); // all[1] is older

    const result = await repo.find({ since });
    expect(result).toHaveLength(1);
    expect(result[0].protocols.get('lore')?.trailers['Lore-id']?.[0]).toBe('00000002');
  });

  it('Coarse Filtering: should handle relative dates (e.g., "1 hour ago")', async () => {
    const result = await repo.find({ since: '1 hour ago' });
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('Coarse Filtering: should handle commit references (e.g., "HEAD~2")', async () => {
    const result = await repo.find({ since: 'HEAD~4' });
    expect(result).toHaveLength(2);
  });

  it('Coarse Filtering: should handle until filtering with refs (e.g., "HEAD~1")', async () => {
    // HEAD~2 is atom #2 (valid)
    const result = await repo.find({ until: 'HEAD~2' });
    expect(result).toHaveLength(2);
    const ids = result.map(a => a.protocols.get('lore')?.trailers['Lore-id']?.[0]);
    expect(ids).toContain('00000001');
    expect(ids).toContain('00000002');
  });

  it('Coarse Filtering: should handle commit hashes', async () => {
    const all = await repo.find();
    const hash = all[0].commitHash;
    const result = await repo.find({ until: hash, maxCommits: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].commitHash).toBe(hash);
  });

  it('Coarse Filtering: should handle garbage date strings gracefully', async () => {
    const result = await repo.find({ since: 'not-a-date' });
    expect(Array.isArray(result)).toBe(true);
  });
});
