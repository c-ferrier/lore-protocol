import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GitClient } from '../../../src/engine/services/git-client.js';
import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Git Impact Radius (System)', () => {
  const testDir = join(process.cwd(), '.test-impact-radius');
  let client: GitClient;

  const run = (cmd: string) => execSync(cmd, { cwd: testDir, stdio: 'ignore' });

  beforeAll(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    run('git init');
    run('git config user.email "test@example.com"');
    run('git config user.name "Test User"');

    // Commit 1: Multiple files in nested dirs
    mkdirSync(join(testDir, 'src/auth'), { recursive: true });
    writeFileSync(join(testDir, 'src/auth/login.ts'), 'content');
    writeFileSync(join(testDir, 'README.md'), 'content');
    run('git add .');
    run('git commit -m "feat: first\n\nMock-id: 00000001"');

    // Commit 2: Single file
    writeFileSync(join(testDir, 'src/auth/session.ts'), 'content');
    run('git add .');
    run('git commit -m "feat: second\n\nMock-id: 00000002"');
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should retrieve relative file paths in the combined stream', async () => {
    client = new GitClient(testDir);
    const commits = await client.log(['-n', '2']);

    expect(commits).toHaveLength(2);

    // Verify Commit 2 (Session only)
    const second = commits.find(c => c.subject === 'feat: second');
    expect(second?.filesChanged).toEqual(['src/auth/session.ts']);

    // Verify Commit 1 (Login + README)
    const first = commits.find(c => c.subject === 'feat: first');
    expect(first?.filesChanged).toContain('src/auth/login.ts');
    expect(first?.filesChanged).toContain('README.md');
  });

  it('should respect path scoping in the combined stream', async () => {
    client = new GitClient(testDir);
    // Query only for README.md
    const commits = await client.log(['--', 'README.md']);

    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe('feat: first');
    // Note: Git's --name-only truncates the file list to only show files that match the path scope
    expect(commits[0].filesChanged).toContain('README.md');
  });
});
