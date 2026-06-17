import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll,beforeAll, describe, expect, it } from 'vitest';

import { GitClient } from '../../src/shell/git/git-client.js';

describe('GitClient Bulk Fetch (System)', () => {
  const testDir = join(tmpdir(), `lore-test-git-bulk-${Math.random().toString(36).slice(2)}`);
  let client: GitClient;
  const commitHashes: string[] = [];

  const run = (cmd: string) => execSync(cmd, { cwd: testDir, stdio: 'ignore' });

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    run('git init');
    run('git config user.email "test@example.com"');
    run('git config user.name "Test User"');

    // Create 5 commits
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(testDir, `file${i + 1}.txt`), `content ${i + 1}`);
      run(`git add file${i + 1}.txt`);
      run(`git commit -m "feat: commit ${i + 1}"`);
      const hash = execSync('git rev-parse HEAD', { cwd: testDir }).toString().trim();
      commitHashes.push(hash);
    }

    client = new GitClient(testDir);
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should fetch multiple commits by their hashes in one call', async () => {
    const results = await Array.fromAsync(client.getLogStream("", { stdin: commitHashes.join("\n"), nameOnly: true }));

    expect(results).toHaveLength(5);
    // Verify each result matches its hash
    for (let i = 0; i < 5; i++) {
      const commit = results.find((c: string) => c.startsWith(commitHashes[i]));
      expect(commit).toBeDefined();
      expect(commit?.includes(`file${i + 1}.txt`)).toBe(true);
    }
  });

  it('should handle empty input gracefully', async () => {
    const results = await Array.fromAsync(client.getLogStream("", { stdin: [].join("\n"), nameOnly: true }));
    expect(results).toHaveLength(0);
  });
});
