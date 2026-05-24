import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SearchFilter } from "../../src/services/search-filter.js";
import { AtomRepository } from '../../src/services/atom-repository.js';
import { GitClient } from '../../src/services/git-client.js';
import { TrailerParser } from '../../src/services/trailer-parser.js';
import { Protocol } from '../../src/services/protocol.js';
import { LoreProtocolDefinition } from '../../src/protocols/lore.js';
import { ProtocolRegistry } from '../../src/services/protocol-registry.js';
import { NullAtomCache } from '../../src/services/atom-cache.js';
import { NullQueryCache } from '../../src/services/query-cache.js';
import { DEFAULT_CONFIG } from '../../src/util/constants.js';

const IDENTITY_KEY = "Lore-id";

describe('AtomRepository False Positive Repro', () => {
  const testDir = join(process.cwd(), 'tests/tmp-repro-test');
  let repo: AtomRepository;
  let gitClient: GitClient;

  beforeAll(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    const run = (cmd: string) => execSync(cmd, { cwd: testDir });
    run('git init -b main');
    run('git config user.name "Test"');
    run('git config user.email "test@example.com"');

    // 1. Valid Lore Commit
    writeFileSync(join(testDir, 'file1.txt'), 'content1');
    run('git add .');
    run(`git commit -m "feat: valid atom\n\n${IDENTITY_KEY}: 12345678"`);

    // 2. False Positive Commit (Mentioning ID in body)
    writeFileSync(join(testDir, 'file2.txt'), 'content2');
    run('git add .');
    run(`git commit -m "feat: false positive\n\nMentioning ${IDENTITY_KEY}: 12345678 in the middle of a sentence."`);

    gitClient = new GitClient(testDir);
    const protocol = new Protocol(LoreProtocolDefinition, DEFAULT_CONFIG);
    const protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(protocol);
    const trailerParser = new TrailerParser();
    const searchFilter = new SearchFilter(protocolRegistry);
    const atomCache = new NullAtomCache();
    const queryCache = new NullQueryCache();
    repo = new AtomRepository(
      gitClient,
      trailerParser,
      protocol,
      protocolRegistry,
      searchFilter,
      atomCache,
      queryCache
    );
    });
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('findById should use an anchored grep (repro failure)', async () => {
    // We spy on gitClient.log to see the arguments
    const logSpy = vi.spyOn(gitClient, 'log');
    
    const result = await repo.findById('12345678');
    
    const callArgs = logSpy.mock.calls[0][0];
    // Check that it uses an anchored grep
    expect(callArgs.some(arg => arg.includes(`--grep=^${IDENTITY_KEY}: 12345678`))).toBe(true);
    
    // Check that it only found 1 atom
    expect(result).not.toBeNull();
    expect(result?.protocols.get('lore')?.trailers['Lore-id']?.[0]).toBe('12345678');
    
    logSpy.mockRestore();
  });

  it('findAll should use an anchored grep (repro failure)', async () => {
    const logSpy = vi.spyOn(gitClient, 'log');
    
    // When searching for an atom, it should only return the one where the ID is in a trailer
    const matchedAtoms = await repo.findAll({});
    
    const matchedCommits = await logSpy.mock.results[0].value;
    // DESIRED: It should only match 1 commit (the valid one).
    expect(matchedCommits).toHaveLength(1);
    
    logSpy.mockRestore();
  });
});
