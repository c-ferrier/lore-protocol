import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AtomRepository } from '../../src/services/atom-repository.js';
import { GitClient } from '../../src/services/git-client.js';
import { TrailerParser } from '../../src/services/trailer-parser.js';
import { Protocol } from '../../src/services/protocol.js';
import { SearchFilter } from '../../src/services/search-filter.js';
import { DEFAULT_CONFIG, LORE_ID_KEY } from '../../src/util/constants.js';

describe('AtomRepository Git Integration', () => {
  const testDir = realpathSync(tmpdir()) + '/lore-git-test-' + Math.random().toString(36).slice(2);
  let repo: AtomRepository;
  let protocol: Protocol;
  let searchFilter: SearchFilter;

  beforeAll(() => {
    // Setup a clean git repo
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    
    const run = (cmd: string) => execSync(cmd, { cwd: testDir });
    
    run('git init -b main');
    run('git config user.name "Test User"');
    run('git config user.email "test@example.com"');

    // 1. Valid Lore Atom (oldest) @ 10:00:00
    writeFileSync(join(testDir, 'msg1.txt'), `feat(auth): login feature\n\n${LORE_ID_KEY}: 00000001\nConfidence: high`);
    writeFileSync(join(testDir, 'file1.txt'), 'content1');
    run('git add .');
    run(`GIT_AUTHOR_DATE="2026-05-23T10:00:00Z" GIT_COMMITTER_DATE="2026-05-23T10:00:00Z" git commit -F msg1.txt`);
    
    // 2. Another Valid Lore Atom @ 10:00:10
    run('git config user.name "Other User"');
    writeFileSync(join(testDir, 'msg2.txt'), `fix(ui): layout\n\n${LORE_ID_KEY}: 00000002\nConfidence: low`);
    writeFileSync(join(testDir, 'file2.txt'), 'content2');
    run('git add .');
    run(`GIT_AUTHOR_DATE="2026-05-23T10:00:10Z" GIT_COMMITTER_DATE="2026-05-23T10:00:10Z" git commit -F msg2.txt`);

    // 3. Non-Lore Commit (Chore) @ 10:00:20
    writeFileSync(join(testDir, 'file3.txt'), 'content3');
    run('git add .');
    run(`GIT_AUTHOR_DATE="2026-05-23T10:00:20Z" GIT_COMMITTER_DATE="2026-05-23T10:00:20Z" git commit -m "chore: cleanup"`);

    // 4. False Positive @ 10:00:30
    writeFileSync(join(testDir, 'file4.txt'), 'content4');
    run('git add .');
    run(`GIT_AUTHOR_DATE="2026-05-23T10:00:30Z" GIT_COMMITTER_DATE="2026-05-23T10:00:30Z" git commit -m "feat: fake\n\nNot a ${LORE_ID_KEY}: 12345678"`);

    const gitClient = new GitClient(testDir);
    protocol = new Protocol(DEFAULT_CONFIG);
    const trailerParser = new TrailerParser(protocol);
    searchFilter = new SearchFilter();
    
    repo = new AtomRepository(gitClient, trailerParser, protocol, searchFilter);
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('Discovery Mode: should only return commits with valid Lore-id trailers', async () => {
    const result = await repo.findAll({});
    expect(result).toHaveLength(2);
    const ids = result.map(a => a.loreId);
    expect(ids).toContain('00000001');
    expect(ids).toContain('00000002');
  });

  it('Coarse Filtering: should correctly filter by author at Git level', async () => {
    const result = await repo.findAll({ author: 'test@example.com' });
    expect(result).toHaveLength(2); 
  });

  it('Coarse Filtering: should correctly filter by scope at Git level', async () => {
    const result = await repo.findAll({ scope: 'auth' });
    expect(result).toHaveLength(1);
    expect(result[0].loreId).toBe('00000001');
  });

  it('Coarse Filtering: should handle AND logic (all-match) at Git level', async () => {
    const result = await repo.findAll({ author: 'test@example.com', scope: 'ui' });
    expect(result).toHaveLength(1);
    expect(result[0].loreId).toBe('00000002');
  });

  it('Coarse Filtering: should handle absolute ISO dates', async () => {
    const result = await repo.findAll({ since: '2026-05-23T10:00:05Z' });
    expect(result).toHaveLength(1);
    expect(result[0].loreId).toBe('00000002');
  });

  it('Coarse Filtering: should handle relative dates (e.g., "1 year ago")', async () => {
    const result = await repo.findAll({ since: '1 year ago' });
    expect(result).toHaveLength(2);
  });

  it('Coarse Filtering: should handle commit references (e.g., "HEAD~2")', async () => {
    // HEAD~2 is Atom 2 @ 10:00:10
    const result = await repo.findAll({ since: 'HEAD~2' });
    expect(result).toHaveLength(1);
    expect(result[0].loreId).toBe('00000002');
  });

  it('Coarse Filtering: should handle until filtering with refs (e.g., "HEAD~1")', async () => {
    // HEAD~1 is Chore @ 10:00:20
    const result = await repo.findAll({ until: 'HEAD~1' });
    expect(result).toHaveLength(2);
    const ids = result.map(a => a.loreId);
    expect(ids).toContain('00000001');
    expect(ids).toContain('00000002');
  });

  it('Coarse Filtering: should handle commit hashes', async () => {
    const atoms = await repo.findAll({});
    const atom2 = atoms.find(a => a.loreId === '00000002')!;
    const hash = atom2.commitHash;

    const resultSince = await repo.findAll({ since: hash });
    expect(resultSince.map(a => a.loreId)).toContain('00000002');
  });

  it('Coarse Filtering: should handle garbage date strings gracefully', async () => {
    const result = await repo.findAll({ since: 'not-a-date' });
    expect(result).toHaveLength(0);

    const resultUntil = await repo.findAll({ until: 'garbage-date' });
    expect(resultUntil).toHaveLength(2);
  });
});
