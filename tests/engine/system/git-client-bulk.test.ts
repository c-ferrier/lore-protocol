import { GitClient } from '../../../src/engine/shell/git/git-client.js';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('GitClient Bulk Fetch (System)', () => {
  const testDir = join(tmpdir(), `lore-test-git-bulk-${Math.random().toString(36).slice(2)}`);
  let client: GitClient;
  let commitHashes: string[] = [];

  const run = (cmd: string) => execSync(cmd, { cwd: testDir, stdio: 'ignore' });

  beforeAll(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    run('git init');
    run('git config user.email "test@example.com"');
    run('git config user.name "Test User"');

    // Create 3 commits
    for (let i = 1; i <= 3; i++) {
        writeFileSync(join(testDir, `file${i}.txt`), `content${i}`);
        run('git add .');
        run(`git commit -m "feat: commit ${i}\n\nMock-id: 0000000${i}"`);
        const hash = execSync('git rev-parse HEAD', { cwd: testDir }).toString().trim();
        commitHashes.push(hash);
    }
    
    client = new GitClient(testDir);
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should physically fetch multiple commits by their hashes using real Git', async () => {
    // This test exercises the combined-stream command generation logic.
    // It will catch flag conflicts (like --no-patch vs --name-only).
    const results = await client.getCommitsByHashes(commitHashes);

    expect(results).toHaveLength(3);
    
    // Verify each commit is present and has its files
    for (let i = 0; i < 3; i++) {
        const hash = commitHashes[i];
        const commit = results.find(c => c.hash.startsWith(hash));
        expect(commit).toBeDefined();
        expect(commit?.subject).toBe(`feat: commit ${i + 1}`);
        expect(commit?.filesChanged).toContain(`file${i + 1}.txt`);
    }
  });

  it('should handle empty input gracefully', async () => {
    const results = await client.getCommitsByHashes([]);
    expect(results).toHaveLength(0);
  });
});