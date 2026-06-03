import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerCommitCommand } from '../../../src/engine/commands/commit.js';
import type { IGitClient } from '../../../src/engine/interfaces/git-client.js';
import type { IOutputFormatter } from '../../../src/engine/interfaces/output-formatter.js';
import type { CommitInputResolver } from '../../../src/engine/services/commit-input-resolver.js';
import type { HeadIdReader } from '../../../src/engine/services/head-id-reader.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { 
    TEST_ID_KEY,
    TEST_ENGINE_CONFIG, 
    makeProtocol, 
    makeProtocolRegistry, 
    makeMockGitClient, 
    makeMockFormatter, 
    makeMockInputResolver, 
    makeMockHeadIdReader,
    makeCommitInput
} from '../engine-test-utils.js';

import * as FormattingLogic from '../../../src/engine/logic/commit-formatting.js';

vi.mock('../../../src/engine/logic/commit-formatting.js', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        formatCommit: vi.fn(actual.formatCommit),
        validateFormatting: vi.fn().mockResolvedValue([])
    };
});

async function runCommitCommand(args: string[], deps: any): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerCommitCommand(program, deps);
  await program.parseAsync(['node', 'atom', 'commit', ...args]);
}

function createDeps(overrides: any = {}) {
  const protocol = makeProtocol();
  const protocolRegistry = makeProtocolRegistry([protocol]);

  return {
    gitClient: makeMockGitClient(),
    getFormatter: () => makeMockFormatter(),
    commitInputResolver: makeMockInputResolver(),
    headIdReader: makeMockHeadIdReader(),
    config: TEST_ENGINE_CONFIG,
    protocol,
    protocolRegistry,
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    ...overrides
  };
}

describe('atom commit --amend', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  it('should skip staged-changes guard when --amend is used', async () => {
    const gitClient = makeMockGitClient({ hasStagedChanges: vi.fn().mockResolvedValue(false) });
    const deps = createDeps({ gitClient });

    await runCommitCommand(['--amend', '--subject', 'amend test'], deps);

    expect(gitClient.hasStagedChanges).not.toHaveBeenCalled();
  });

  it(`should pass existing ${TEST_ID_KEY} to formatCommit when amending`, async () => {
    const headIdReader = makeMockHeadIdReader({ 
        readIds: vi.fn().mockResolvedValue({ mock: 'cafebabe' }) 
    });
    const commitInputResolver = makeMockInputResolver({
        read: vi.fn().mockResolvedValue(makeCommitInput({ subject: 'amend test' }))
    });
    const deps = createDeps({ headIdReader, commitInputResolver });

    await runCommitCommand(['--amend', '--subject', 'amend test'], deps);

    expect(headIdReader.readIds).toHaveBeenCalledOnce();
    expect(FormattingLogic.formatCommit).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'amend test' }),
      expect.anything(),
      expect.anything(),
      { mock: 'cafebabe' }
    );
  });

  it('should pass --amend flag to gitClient.commit', async () => {
    const deps = createDeps();

    await runCommitCommand(['--amend', '--subject', 'amend test'], deps);

    expect(deps.gitClient.commit).toHaveBeenCalledWith(
      expect.stringContaining('Mock-id:'),
      { amend: true },
    );
  });

  it('should bypass processing with --amend --no-edit', async () => {
    const deps = createDeps();

    await runCommitCommand(['--amend', '--no-edit'], deps);

    expect(deps.commitInputResolver.read).not.toHaveBeenCalled();
    expect(FormattingLogic.formatCommit).not.toHaveBeenCalled();
    expect(deps.gitClient.commit).toHaveBeenCalledWith(
      '',
      { amend: true, noEdit: true },
    );
  });

  it('should allow --amend --no-edit when combined with global engine flags', async () => {
    const deps = createDeps();

    // Simulation of 'lore commit --amend --no-edit --context /path --no-color'
    const program = new Command();
    program.exitOverride();
    program.option('--context <path>');
    program.option('--no-color');
    registerCommitCommand(program, deps);
    
    await program.parseAsync(['node', 'atom', '--context', '/repo', '--no-color', 'commit', '--amend', '--no-edit']);

    expect(deps.gitClient.commit).toHaveBeenCalledWith(
      '',
      { amend: true, noEdit: true },
    );
  });

  it('should throw when --no-edit is combined with --file', async () => {
    const deps = createDeps();
    await expect(
      runCommitCommand(['--amend', '--no-edit', '--file', 'input.json'], deps),
    ).rejects.toThrow('--no-edit keeps the existing message unchanged');
  });

  it('should throw when --no-edit is combined with --subject', async () => {
    const deps = createDeps();
    await expect(
      runCommitCommand(['--amend', '--no-edit', '--subject', 'new'], deps),
    ).rejects.toThrow('--no-edit keeps the existing message unchanged');
  });

  it('should throw when --no-edit is combined with --interactive', async () => {
    const deps = createDeps();
    await expect(
      runCommitCommand(['--amend', '--no-edit', '-i'], deps),
    ).rejects.toThrow('--no-edit keeps the existing message unchanged');
  });

  it('should throw when --no-edit is combined with --body', async () => {
    const deps = createDeps();
    await expect(
      runCommitCommand(['--amend', '--no-edit', '--body', 'some context'], deps),
    ).rejects.toThrow('--no-edit keeps the existing message unchanged');
  });

  it('should throw when --no-edit is used without --amend', async () => {
    const deps = createDeps();

    await expect(
      runCommitCommand(['--no-edit', '--subject', 'test'], deps),
    ).rejects.toThrow('--no-edit can only be used with --amend');
  });

  it(`should generate new ${TEST_ID_KEY} when amending a non-Mock commit`, async () => {
    const headIdReader = makeMockHeadIdReader({});
    const deps = createDeps({ headIdReader });

    await runCommitCommand(['--amend', '--subject', 'amend non-mock'], deps);

    expect(headIdReader.readIds).toHaveBeenCalledOnce();
    expect(FormattingLogic.formatCommit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      {},
    );
  });

  it(`should not read ${TEST_ID_KEY} from HEAD for normal commits`, async () => {
    const headIdReader = makeMockHeadIdReader({ mock: 'cafebabe' });
    const deps = createDeps({ headIdReader });

    await runCommitCommand(['--subject', 'normal commit'], deps);

    expect(headIdReader.readIds).not.toHaveBeenCalled();
    expect(FormattingLogic.formatCommit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
    );
  });

  it('should check staged changes for normal commits', async () => {
    const gitClient = makeMockGitClient();
    const deps = createDeps({ gitClient });

    await runCommitCommand(['--subject', 'normal'], deps);

    expect(gitClient.hasStagedChanges).toHaveBeenCalledOnce();
  });
});
