import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerCommitCommand } from '../../../../src/engine/commands/commit.js';
import { 
    TEST_ENGINE_CONFIG, 
    makeProtocol, 
    makeProtocolRegistry, 
    makeMockGitClient, 
    makeMockFormatter, 
    makeMockCommitBuilder, 
    makeMockInputResolver, 
    makeMockHeadIdReader 
} from '../test-utils.js';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';

function createDeps(overrides: any = {}) {
  const protocol = makeProtocol();
  const protocolRegistry = makeProtocolRegistry([protocol]);

  return {
    commitBuilder: makeMockCommitBuilder(),
    gitClient: makeMockGitClient(),
    getFormatter: () => makeMockFormatter(),
    commitInputResolver: makeMockInputResolver(),
    headIdReader: makeMockHeadIdReader(),
    config: TEST_ENGINE_CONFIG,
    protocol,
    protocolRegistry,
    trailerParser: new TrailerParser(),
    ...overrides
  };
}

describe('atom commit (validation logic)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should abort commit if validation returns errors', async () => {
    const gitClient = makeMockGitClient();
    const commitBuilder = makeMockCommitBuilder({
        validate: vi.fn().mockReturnValue([{ severity: 'error', rule: 'test-err', message: 'Fatal issue' }])
    });
    const deps = createDeps({ gitClient, commitBuilder });

    const program = new Command();
    program.exitOverride();
    registerCommitCommand(program, deps);

    await expect(
        program.parseAsync(['node', 'atom', 'commit', '--subject', 'test'])
    ).rejects.toThrow('Validation failed');

    expect(gitClient.commit).not.toHaveBeenCalled();
  });

  it('should proceed with commit but log warnings if validation returns warnings only', async () => {
    const gitClient = makeMockGitClient();
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as any;
    const commitBuilder = makeMockCommitBuilder({
        validate: vi.fn().mockReturnValue([{ severity: 'warning', rule: 'test-warn', message: 'Hygiene issue' }])
    });
    const deps = createDeps({ gitClient, commitBuilder, logger });

    const program = new Command();
    program.exitOverride();
    registerCommitCommand(program, deps);

    await program.parseAsync(['node', 'atom', 'commit', '--subject', 'test']);

    expect(gitClient.commit).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Hygiene issue');
  });
});
