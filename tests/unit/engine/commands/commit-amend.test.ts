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
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG } from '../test-utils.js';

const MOCK_ID_KEY = "Mock-id";


function createMockGitClient(): IGitClient {
  return {
    log: vi.fn().mockResolvedValue([]),
    blame: vi.fn().mockResolvedValue([]),
    commit: vi.fn().mockResolvedValue({ hash: 'abc1234', success: true, message: 'Commit successful', rawMessage: 'Commit successful' }),
    hasStagedChanges: vi.fn().mockResolvedValue(true),
    getRepoRoot: vi.fn().mockResolvedValue('/repo'),
    isInsideRepo: vi.fn().mockResolvedValue(true),
    getFilesChanged: vi.fn().mockResolvedValue(new Map()),
    countCommitsSince: vi.fn().mockResolvedValue(0),
    resolveRef: vi.fn().mockResolvedValue('abc1234'),
    getHeadMessage: vi.fn().mockResolvedValue(''),
    countAllCommits: vi.fn().mockResolvedValue(0),
    listTrackedFiles: vi.fn().mockResolvedValue([]),
  } as any;
}

function createMockFormatter(): IOutputFormatter {
  return {
    formatQueryResult: vi.fn().mockReturnValue(''),
    formatValidationResult: vi.fn().mockReturnValue(''),
    formatStalenessResult: vi.fn().mockReturnValue(''),
    formatTraceResult: vi.fn().mockReturnValue(''),
    formatDoctorResult: vi.fn().mockReturnValue(''),
    formatSuccess: vi.fn().mockReturnValue(''),
    formatError: vi.fn().mockReturnValue(''),
    formatConfig: vi.fn().mockReturnValue(''),
  } as any;
}

function createMockCommitBuilder(): CommitBuilder {
  return {
    build: vi.fn().mockReturnValue({ 
      message: 'built message', 
      protocols: { mock: { id: 'a1b2c3d4', version: '1.0' } } 
    }),
    validate: vi.fn().mockReturnValue([]),
  } as unknown as CommitBuilder;
}

function createMockInputResolver(): CommitInputResolver {
  return {
    resolve: vi.fn().mockResolvedValue({ subject: 'test commit' }),
  } as unknown as CommitInputResolver;
}

function createMockHeadIdReader(ids: Record<string, string> = {}): HeadIdReader {
  return {
    readIds: vi.fn().mockResolvedValue(ids),
    read: vi.fn().mockResolvedValue(Object.values(ids)[0] || null),
  } as unknown as HeadIdReader;
}

async function runCommitCommand(args: string[], deps: ReturnType<typeof createDeps>): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerCommitCommand(program, deps);
  await program.parseAsync(['node', 'atom', 'commit', ...args]);
}

function createDeps(overrides?: {
  headIdReader?: HeadIdReader;
  gitClient?: IGitClient;
}) {
  const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG);
  const protocolRegistry = new ProtocolRegistry();
  protocolRegistry.register(protocol);

  return {
    commitBuilder: createMockCommitBuilder(),
    gitClient: overrides?.gitClient ?? createMockGitClient(),
    getFormatter: () => createMockFormatter(),
    commitInputResolver: createMockInputResolver(),
    headIdReader: overrides?.headIdReader ?? createMockHeadIdReader(),
    config: MOCK_CONFIG,
    protocol,
    protocolRegistry,
    trailerParser: new TrailerParser(),
  };
}

describe('atom commit --amend', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should skip staged-changes guard when --amend is used', async () => {
    const gitClient = createMockGitClient();
    vi.mocked(gitClient.hasStagedChanges).mockResolvedValue(false);
    const deps = createDeps({ gitClient });

    await runCommitCommand(['--amend', '--subject', 'amend test'], deps);

    expect(gitClient.hasStagedChanges).not.toHaveBeenCalled();
  });

  it(`should pass existing ${MOCK_ID_KEY} to commitBuilder.build when amending`, async () => {
    const headIdReader = createMockHeadIdReader({ mock: 'cafebabe' });
    const deps = createDeps({ headIdReader });

    await runCommitCommand(['--amend', '--subject', 'amend test'], deps);

    expect(headIdReader.readIds).toHaveBeenCalledOnce();
    expect(deps.commitBuilder.build).toHaveBeenCalledWith(
      expect.anything(),
      { mock: 'cafebabe' },
    );
  });

  it('should pass --amend flag to gitClient.commit', async () => {
    const deps = createDeps();

    await runCommitCommand(['--amend', '--subject', 'amend test'], deps);

    expect(deps.gitClient.commit).toHaveBeenCalledWith(
      'built message',
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
    const headIdReader = createMockHeadIdReader({});
    const deps = createDeps({ headIdReader });

    await runCommitCommand(['--amend', '--subject', 'amend non-mock'], deps);

    expect(headIdReader.readIds).toHaveBeenCalledOnce();
    expect(deps.commitBuilder.build).toHaveBeenCalledWith(
      expect.anything(),
      {},
    );
  });

  it(`should not read ${MOCK_ID_KEY} from HEAD for normal commits`, async () => {
    const headIdReader = createMockHeadIdReader({ mock: 'cafebabe' });
    const deps = createDeps({ headIdReader });

    await runCommitCommand(['--subject', 'normal commit'], deps);

    expect(headIdReader.readIds).not.toHaveBeenCalled();
    expect(deps.commitBuilder.build).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
    );
  });

  it('should check staged changes for normal commits', async () => {
    const gitClient = createMockGitClient();
    const deps = createDeps({ gitClient });

    await runCommitCommand(['--subject', 'normal'], deps);

    expect(gitClient.hasStagedChanges).toHaveBeenCalledOnce();
  });
});
