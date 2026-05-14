import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AtomRepository } from '../../../src/services/atom-repository.js';
import { GitClient } from '../../../src/services/git-client.js';
import { TrailerParser } from '../../../src/services/trailer-parser.js';

describe('AtomRepository Git Integration', () => {
  const testDir = join(process.cwd(), 'tests/tmp-git-test');
  let repo: AtomRepository;

  beforeAll(() => {
    // Setup a clean git repo
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    
    const run = (cmd: string) => execSync(cmd, { cwd: testDir });
    
    run('git init -b main');
    run('git config user.name "Test User"');
    run('git config user.email "test@example.com"');

    // 1. Valid Lore Atom
    writeFileSync(join(testDir, 'file1.txt'), 'content1');
    run('git add .');
    run('git commit -m "feat(auth): login feature\n\nLore-id: 00000001\nConfidence: high"');

    // 2. Another Valid Lore Atom (different scope/author)
    run('git config user.name "Other User"');
    writeFileSync(join(testDir, 'file2.txt'), 'content2');
    run('git add .');
    run('git commit -m "fix(ui): layout\n\nLore-id: 00000002\nConfidence: low"');

    // 3. Non-Lore Commit (Should be filtered by discovery mode)
    writeFileSync(join(testDir, 'file3.txt'), 'content3');
    run('git add .');
    run('git commit -m "chore: just a cleanup"');

    // 4. False Positive (Has Lore-id in body, but not formatted as trailer)
    // Actually, our Discovery Mode regex is '^Lore-id: ', so we'll test that.
    writeFileSync(join(testDir, 'file4.txt'), 'content4');
    run('git add .');
    run('git commit -m "feat: fake\n\nNot really a Lore-id: 12345678"');

    const gitClient = new GitClient(testDir);
    const trailerParser = new TrailerParser();
    
    repo = new AtomRepository(
      gitClient,
      trailerParser,
    );
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('Discovery Mode: should only return commits with valid Lore-id trailers', async () => {
    const result = await repo.findAll({});
    // Should find #1 and #2, but not #3 (chore) or #4 (fake trailer)
    expect(result).toHaveLength(2);
    const ids = result.map(a => a.loreId);
    expect(ids).toContain('00000001');
    expect(ids).toContain('00000002');
  });

  it('Coarse Filtering: should correctly filter by author at Git level', async () => {
    const result = await repo.findAll({ author: 'test@example.com' });
    expect(result).toHaveLength(2); // Both lore atoms have same email
  });

  it('Coarse Filtering: should correctly filter by scope at Git level', async () => {
    const result = await repo.findAll({ scope: 'auth' });
    expect(result).toHaveLength(1);
    expect(result[0].loreId).toBe('00000001');
  });

  it('Coarse Filtering: should handle AND logic (all-match) at Git level', async () => {
    // Search for author "test@example.com" AND scope "ui" (should be 1)
    const result2 = await repo.findAll({ author: 'test@example.com', scope: 'ui' });
    expect(result2).toHaveLength(1);
    expect(result2[0].loreId).toBe('00000002');
  });

  it('Coarse Filtering: should handle date-based filtering (since/until)', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const resultFuture = await repo.findAll({ since: tomorrow.toISOString() });
    expect(resultFuture).toHaveLength(0);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const resultPast = await repo.findAll({ since: yesterday.toISOString() });
    expect(resultPast).toHaveLength(2);
  });
});
