import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll,beforeAll, describe, expect, it } from 'vitest';

import { GitClient } from '../../../src/engine/shell/git/git-client.js';

describe('Git Impact Radius (System)', () => {
  const testDir = join(tmpdir(), `lore-test-impact-radius-${Math.random().toString(36).slice(2)}`);
  let client: GitClient;

  const run = (cmd: string) => execSync(cmd, { cwd: testDir, stdio: 'ignore' });

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    run('git init');
    run('git config user.email "test@example.com"');
    run('git config user.name "Test User"');

    // Create a chain of related files
    mkdirSync(join(testDir, 'src'), { recursive: true });
    writeFileSync(join(testDir, 'README.md'), 'initial');
    run('git add README.md');
    run('git commit -m "feat: first"');

    writeFileSync(join(testDir, 'src/logic.ts'), 'export const a = 1;');
    run('git add src/logic.ts');
    run('git commit -m "feat: add logic"');

    client = new GitClient(testDir);
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should verify the impact radius logic with real Git history', async () => {
    // This tests the getCommitsByHashes and name-only path limiting
    const commits = await client.getCommitsByHashes(['HEAD'], ['README.md']);
    
    // Should find the commit because getCommitsByHashes is a FETCH operation (names only)
    expect(commits).toHaveLength(1);

    const commitsMatch = await client.getCommitsByHashes(['HEAD'], ['src/logic.ts']);
    expect(commitsMatch).toHaveLength(1);
    expect(commitsMatch[0].subject).toBe('feat: add logic');
  });

  it('should correctly report files changed when no path limiting is applied', async () => {
    const commits = await client.getCommitsByHashes(['HEAD^']);
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe('feat: first');
    // Note: Git's --name-only truncates the file list to only show files that match the path scope
    expect(commits[0].filesChanged).toContain('README.md');
  });
});
