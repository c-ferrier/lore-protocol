import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerCommitCommand } from '../../../../src/engine/commands/commit.js';
import type { CommitBuilder } from '../../../../src/engine/services/commit-builder.js';
import type { IGitClient } from '../../../../src/engine/interfaces/git-client.js';
import type { IOutputFormatter } from '../../../../src/engine/interfaces/output-formatter.js';
import type { CommitInputResolver } from '../../../../src/engine/services/commit-input-resolver.js';
import type { HeadIdReader } from '../../../../src/engine/services/head-id-reader.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG, makeProtocol } from '../test-utils.js';

function createMockGitClient(): IGitClient {
  return {
    commit: vi.fn().mockResolvedValue({ hash: 'abc1234', success: true }),
    hasStagedChanges: vi.fn().mockResolvedValue(true),
    isInsideRepo: vi.fn().mockResolvedValue(true),
  } as any;
}

function createMockFormatter(): IOutputFormatter {
  return {
    formatSuccess: vi.fn().mockReturnValue('SUCCESS'),
    formatError: vi.fn().mockReturnValue('ERROR'),
  } as any;
}

function createMockCommitBuilder(validationIssues: any[] = []): CommitBuilder {
  return {
    build: vi.fn().mockReturnValue({ 
      message: 'built message', 
      protocols: { mock: { id: 'id1', version: '1.0' } } 
    }),
    validate: vi.fn().mockReturnValue(validationIssues),
  } as unknown as CommitBuilder;
}

function createMockInputResolver(): CommitInputResolver {
  return {
    resolve: vi.fn().mockResolvedValue({ subject: 'test' }),
  } as unknown as CommitInputResolver;
}

function createMockHeadIdReader(): HeadIdReader {
  return {
    readIds: vi.fn().mockResolvedValue({}),
  } as unknown as HeadIdReader;
}

describe('atom commit (validation logic)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should abort commit if validation returns errors', async () => {
    const gitClient = createMockGitClient();
    const commitBuilder = createMockCommitBuilder([
        { severity: 'error', rule: 'test-err', message: 'Fatal issue' }
    ]);
    const deps = {
        commitBuilder,
        gitClient,
        getFormatter: () => createMockFormatter(),
        commitInputResolver: createMockInputResolver(),
        headIdReader: createMockHeadIdReader(),
        config: MOCK_CONFIG,
        protocolRegistry: new ProtocolRegistry(),
        trailerParser: new TrailerParser(),
    };

    const program = new Command();
    program.exitOverride();
    registerCommitCommand(program, deps);

    await expect(
        program.parseAsync(['node', 'atom', 'commit', '--subject', 'test'])
    ).rejects.toThrow('Validation failed');

    expect(gitClient.commit).not.toHaveBeenCalled();
  });

  it('should proceed with commit but log warnings if validation returns warnings only', async () => {
    const gitClient = createMockGitClient();
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as any;
    const commitBuilder = createMockCommitBuilder([
        { severity: 'warning', rule: 'test-warn', message: 'Hygiene issue' }
    ]);
    const deps = {
        commitBuilder,
        gitClient,
        getFormatter: () => createMockFormatter(),
        commitInputResolver: createMockInputResolver(),
        headIdReader: createMockHeadIdReader(),
        config: MOCK_CONFIG,
        protocolRegistry: new ProtocolRegistry(),
        trailerParser: new TrailerParser(),
        logger
    };

    const program = new Command();
    program.exitOverride();
    registerCommitCommand(program, deps);

    await program.parseAsync(['node', 'atom', 'commit', '--subject', 'test']);

    expect(gitClient.commit).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Hygiene issue');
  });
});
