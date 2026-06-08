import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach,describe, expect, it } from 'vitest';

import { createQueryTarget } from '../../../src/engine/core/logic/query-targets.js';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { NullQueryCache } from '../../../src/engine/shell/fs/query-cache.js';
import { GitClient } from '../../../src/engine/shell/git/git-client.js';
import { makeStubProtocolContext, MOCK_CORE_TRAILERS,TEST_ID_KEY, TEST_PROTOCOL_DEFINITION } from '../../../src/engine/testing.js';

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
    run(`git commit -m "feat(auth): login feature\n\n${TEST_ID_KEY}: 00000001\nConfidence: high"`);
    
    // Add delay to ensure distinct timestamps for --since tests
    run('sleep 1.1');

    // 2. Another Valid Lore Atom (different scope/author)
    run('git config user.name "Other User"');
    writeFileSync(join(testDir, 'file2.txt'), 'content2');
    run('git add .');
    run(`git commit -m "fix(ui): layout\n\n${TEST_ID_KEY}: 00000002\nConfidence: low"`);

    // 3. Non-Lore Commit (Should be filtered by discovery mode)
    run('sleep 1.1');
    writeFileSync(join(testDir, 'file3.txt'), 'content3');
    run('git add .');
    run('git commit -m "chore: just a cleanup"');

    // 4. Commit with Fake Lore ID (should be filtered if validation fails)
    run('sleep 1.1');
    writeFileSync(join(testDir, 'file4.txt'), 'content4');
    run('git add .');
    run(`git commit -m "feat: fake\n\n${TEST_ID_KEY}: NOT-A-HEX-ID"`);
  });

  beforeEach(() => {
    gitClient = new GitClient(testDir);
    const protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(makeStubProtocolContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
    }));
    const queryCache = new NullQueryCache();

    const baseTarget = createQueryTarget(undefined, {
        cwd: testDir,
        protocolRoot: testDir,
        isScoped: false
    });

    repo = new AtomRepository(
      gitClient,
      protocolRegistry,
      queryCache,
      baseTarget
    );

  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('Discovery Mode: should only return commits with valid Mock-id trailers', async () => {
    const result = await repo.find();
    // Should find #1 and #2, but not #3 (chore) or #4 (fake trailer)
    expect(result).toHaveLength(2);
    const ids = result.map(a => a.protocols.get('mock')?.trailers[TEST_ID_KEY]?.[0]);
    expect(ids).toContain('00000001');
    expect(ids).toContain('00000002');
  });

  it('Coarse Filtering: should correctly filter by author at Git level', async () => {
    const result = await repo.find(undefined, { author: 'test@example.com' });
    expect(result).toHaveLength(2); // Both lore atoms have same email
  });

  it('Coarse Filtering: should correctly filter by scope at Git level', async () => {
    const result = await repo.find(undefined, { scope: 'auth' });
    expect(result).toHaveLength(1);
  });

  it('Coarse Filtering: should handle AND logic (all-match) at Git level', async () => {
    const result = await repo.find(undefined, { author: 'test@example.com', scope: 'auth' });
    expect(result).toHaveLength(1);
  });

  it('Coarse Filtering: should handle date-based filtering (since/until)', async () => {
    const all = await repo.find();
    const midPoint = all[0].date;
    const sinceResult = await repo.find(undefined, { since: midPoint.toISOString() });
    expect(sinceResult.length).toBeGreaterThanOrEqual(1);
  });

  it('Coarse Filtering: should handle relative dates (e.g., "1 hour ago")', async () => {
    const result = await repo.find(undefined, { since: '1 hour ago' });
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('Coarse Filtering: should handle commit references (e.g., "HEAD~2")', async () => {
    const result = await repo.find(undefined, { since: 'HEAD~2' });
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('Coarse Filtering: should handle until filtering with refs (e.g., "HEAD~3")', async () => {
    const result = await repo.find(undefined, { until: 'HEAD~3' });
    // HEAD~3 is the first commit (#1). HEAD~2 is #2, HEAD~1 is #3.
    // until=HEAD~3 includes only #1.
    expect(result).toHaveLength(1);
    expect(result[0].protocols.get('mock')?.trailers[TEST_ID_KEY]?.[0]).toBe('00000001');
  });

  it('Coarse Filtering: should handle commit hashes', async () => {
    const all = await repo.find();
    const hash = all[0].commitHash;
    const result = await repo.find(undefined, { until: hash, maxCommits: 1 });
    
    expect(result.length).toBeGreaterThan(0);
    expect(result.map(r => r.commitHash)).toContain(hash);
  });

  it('Coarse Filtering: should handle garbage date strings gracefully', async () => {
    const result = await repo.find(undefined, { since: 'not-a-date' });
    expect(Array.isArray(result)).toBe(true);
  });
});