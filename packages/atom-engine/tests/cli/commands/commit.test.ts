import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerCommitCommand } from '../../../src/cli/commands/commit.js';
import * as InputResolver from '../../../src/cli/readers/commit-input-resolver.js';
import * as FormattingLogic from '../../../src/core/logic/commit-formatting.js';
import type { EngineInfra } from '../../../src/services/engine-bootstrapper.js';
import * as HeadIdReader from '../../../src/shell/git/head-id-reader.js';
import { 
    makeCommitInput, 
    makeStubProtocolContext, 
    makeStubProtocolMap, 
    TEST_ID_KEY 
} from '../../../src/testing.js';
import { makeMockGitClient,makeMockInfra } from '../../engine-test-utils.js';

vi.mock('../../../src/shell/git/head-id-reader.js', () => ({
    readHeadIdentities: vi.fn().mockResolvedValue({})
}));

vi.mock('../../../src/cli/readers/commit-input-resolver.js', () => ({
    resolveCommitInput: vi.fn().mockResolvedValue({ subject: 'mocked subject', body: '', trailers: new Map() })
}));

vi.mock('../../../src/core/logic/commit-formatting.js', async (importOriginal) => {
    const actual = await importOriginal<typeof FormattingLogic>();
    return {
        ...actual,
        formatCommit: vi.fn(actual.formatCommit),
        validateFormatting: vi.fn().mockReturnValue([])
    };
});

async function runCommitCommand(args: string[], infra: EngineInfra): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerCommitCommand(program, infra);
  await program.parseAsync(['node', 'atom', 'commit', ...args]);
}

function createTestInfra(overrides: Partial<EngineInfra> = {}): EngineInfra {
  const protocol = makeStubProtocolContext();
  const protocols = makeStubProtocolMap([protocol]);
  
  return makeMockInfra({
    protocols,
    ...overrides
  });
}

describe('atom commit --amend', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  it('should skip staged-changes guard when --amend is used', async () => {
    const git = makeMockGitClient({ hasStagedChanges: vi.fn().mockResolvedValue(false) });
    const infra = createTestInfra({ git });

    await runCommitCommand(['--amend', '--subject', 'amend test'], infra);

    expect(git.hasStagedChanges).not.toHaveBeenCalled();
  });

  it(`should pass existing ${TEST_ID_KEY} to formatCommit when amending`, async () => {
    vi.mocked(HeadIdReader.readHeadIdentities).mockResolvedValue({ mock: 'cafebabe' });
    vi.mocked(InputResolver.resolveCommitInput).mockResolvedValue(makeCommitInput({ subject: 'amend test' }));
    const infra = createTestInfra();

    await runCommitCommand(['--amend', '--subject', 'amend test'], infra);

    expect(HeadIdReader.readHeadIdentities).toHaveBeenCalledOnce();
    expect(FormattingLogic.formatCommit).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'amend test' }),
      expect.anything(),
      expect.anything(),
      { mock: 'cafebabe' }
    );
  });

  it('should pass --amend flag to gitClient.commit', async () => {
    const infra = createTestInfra();

    await runCommitCommand(['--amend', '--subject', 'amend test'], infra);

    expect(infra.git.commit).toHaveBeenCalledWith(
      expect.stringContaining('Mock-id:'),
      { amend: true },
    );
  });

  it('should bypass processing with --amend --no-edit', async () => {
    const infra = createTestInfra();

    await runCommitCommand(['--amend', '--no-edit'], infra);

    expect(InputResolver.resolveCommitInput).not.toHaveBeenCalled();
    expect(FormattingLogic.formatCommit).not.toHaveBeenCalled();
    expect(infra.git.commit).toHaveBeenCalledWith(
      '',
      { amend: true, noEdit: true },
    );
  });

  it('should allow --amend --no-edit when combined with global engine flags', async () => {
    const infra = createTestInfra();

    // Simulation of 'lore commit --amend --no-edit --context /path --no-color'
    const program = new Command();
    program.exitOverride();
    program.option('--context <path>');
    program.option('--no-color');
    registerCommitCommand(program, infra);
    
    await program.parseAsync(['node', 'atom', '--context', '/repo', '--no-color', 'commit', '--amend', '--no-edit']);

    expect(infra.git.commit).toHaveBeenCalledWith(
      '',
      { amend: true, noEdit: true },
    );
  });

  it('should throw when --no-edit is combined with --file', async () => {
    const infra = createTestInfra();
    await expect(
      runCommitCommand(['--amend', '--no-edit', '--file', 'input.json'], infra),
    ).rejects.toThrow('--no-edit keeps the existing message unchanged');
  });

  it('should throw when --no-edit is combined with --subject', async () => {
    const infra = createTestInfra();
    await expect(
      runCommitCommand(['--amend', '--no-edit', '--subject', 'new'], infra),
    ).rejects.toThrow('--no-edit keeps the existing message unchanged');
  });

  it('should throw when --no-edit is combined with --interactive', async () => {
    const infra = createTestInfra();
    await expect(
      runCommitCommand(['--amend', '--no-edit', '-i'], infra),
    ).rejects.toThrow('--no-edit keeps the existing message unchanged');
  });

  it('should throw when --no-edit is combined with --body', async () => {
    const infra = createTestInfra();
    await expect(
      runCommitCommand(['--amend', '--no-edit', '--body', 'some context'], infra),
    ).rejects.toThrow('--no-edit keeps the existing message unchanged');
  });

  it('should throw when --no-edit is used without --amend', async () => {
    const infra = createTestInfra();

    await expect(
      runCommitCommand(['--no-edit', '--subject', 'test'], infra),
    ).rejects.toThrow('--no-edit can only be used with --amend');
  });

  it(`should generate new ${TEST_ID_KEY} when amending a non-Mock commit`, async () => {
    vi.mocked(HeadIdReader.readHeadIdentities).mockResolvedValue({});
    const infra = createTestInfra();

    await runCommitCommand(['--amend', '--subject', 'amend non-mock'], infra);

    expect(HeadIdReader.readHeadIdentities).toHaveBeenCalledOnce();
    expect(FormattingLogic.formatCommit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      {},
    );
  });

  it(`should not read ${TEST_ID_KEY} from HEAD for normal commits`, async () => {
    vi.mocked(HeadIdReader.readHeadIdentities).mockResolvedValue({ mock: 'cafebabe' });
    const infra = createTestInfra();

    await runCommitCommand(['--subject', 'normal commit'], infra);

    expect(HeadIdReader.readHeadIdentities).not.toHaveBeenCalled();
    expect(FormattingLogic.formatCommit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
    );
  });

  it('should check staged changes for normal commits', async () => {
    const git = makeMockGitClient();
    const infra = createTestInfra({ git });

    await runCommitCommand(['--subject', 'normal'], infra);

    expect(git.hasStagedChanges).toHaveBeenCalledOnce();
  });
});
