import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerCommitCommand } from '../../../../src/engine/commands/commit.js';
import type { CommitBuilder } from '../../../../src/engine/services/commit-builder.js';
import type { IGitClient } from '../../../../src/engine/interfaces/git-client.js';
import type { IOutputFormatter } from '../../../../src/engine/interfaces/output-formatter.js';
import type { CommitInputResolver } from '../../../../src/engine/services/commit-input-resolver.js';
import type { HeadIdReader } from '../../../../src/engine/services/head-id-reader.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import { 
    MOCK_ID_KEY,
    MOCK_PROTOCOL_DEFINITION, 
    MOCK_CONFIG, 
    makeProtocol, 
    makeProtocolRegistry, 
    makeMockGitClient, 
    makeMockFormatter, 
    makeMockCommitBuilder, 
    makeMockInputResolver, 
    makeMockHeadIdReader 
} from '../test-utils.js';

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
    commitBuilder: makeMockCommitBuilder(),
    gitClient: makeMockGitClient(),
    getFormatter: () => makeMockFormatter(),
    commitInputResolver: makeMockInputResolver(),
    headIdReader: makeMockHeadIdReader(),
    config: MOCK_CONFIG,
    protocol,
    protocolRegistry,
    trailerParser: new TrailerParser(),
    ...overrides
  };
}

describe('atom commit --amend', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should skip staged-changes guard when --amend is used', async () => {
    const gitClient = makeMockGitClient({ hasStagedChanges: vi.fn().mockResolvedValue(false) });
    const deps = createDeps({ gitClient });

    await runCommitCommand(['--amend', '--subject', 'amend test'], deps);

    expect(gitClient.hasStagedChanges).not.toHaveBeenCalled();
  });

  it(`should pass existing ${MOCK_ID_KEY} to commitBuilder.build when amending`, async () => {
    const headIdReader = makeMockHeadIdReader({ 
        readIds: vi.fn().mockResolvedValue({ mock: 'cafebabe' }) 
    });
    const deps = createDeps({ headIdReader });

    await runCommitCommand(['--amend', '--subject', 'amend test'], deps);

    expect(headIdReader.readIds).toHaveBeenCalledOnce();
    expect(deps.commitBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'amend test' }),
      { mock: 'cafebabe' }
    );
  });

  it('should pass --amend flag to gitClient.commit', async () => {
    const deps = createDeps();

    await runCommitCommand(['--amend', '--subject', 'amend test'], deps);

    expect(deps.gitClient.commit).toHaveBeenCalledWith(
      'built',
      { amend: true },
    );
  });

  it('should bypass processing with --amend --no-edit', async () => {
    const deps = createDeps();

    await runCommitCommand(['--amend', '--no-edit'], deps);

    expect(deps.commitInputResolver.resolve).not.toHaveBeenCalled();
    expect(deps.commitBuilder.build).not.toHaveBeenCalled();
    expect(deps.commitBuilder.validate).not.toHaveBeenCalled();
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

  it(`should generate new ${MOCK_ID_KEY} when amending a non-Mock commit`, async () => {
    const headIdReader = makeMockHeadIdReader({});
    const deps = createDeps({ headIdReader });

    await runCommitCommand(['--amend', '--subject', 'amend non-mock'], deps);

    expect(headIdReader.readIds).toHaveBeenCalledOnce();
    expect(deps.commitBuilder.build).toHaveBeenCalledWith(
      expect.anything(),
      {},
    );
  });

  it(`should not read ${MOCK_ID_KEY} from HEAD for normal commits`, async () => {
    const headIdReader = makeMockHeadIdReader({ mock: 'cafebabe' });
    const deps = createDeps({ headIdReader });

    await runCommitCommand(['--subject', 'normal commit'], deps);

    expect(headIdReader.readIds).not.toHaveBeenCalled();
    expect(deps.commitBuilder.build).toHaveBeenCalledWith(
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
