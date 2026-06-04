import { registerCommitCommand } from '../../../src/engine/cli/commands/commit.js';
import { TEST_ENGINE_CONFIG, makeProtocolRegistry } from '../../../src/engine/testing.js';
import { makeMockFormatter, makeMockGitClient, makeMockHeadIdReader, makeMockInputResolver, makeMockProtocolContext } from '../engine-test-utils.js';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

function createDeps(overrides: any = {}) {
  const protocol = makeMockProtocolContext();
  const protocolRegistry = makeProtocolRegistry([protocol as any]);

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

describe('atom commit (validation logic)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should abort commit if validation returns errors', async () => {
    const gitClient = makeMockGitClient();
    const protocol = makeMockProtocolContext({
        validateState: vi.fn().mockReturnValue([{ severity: 'error', rule: 'test-err', message: 'Fatal issue' }])
    });
    const deps = createDeps({ gitClient, protocol, protocolRegistry: makeProtocolRegistry([protocol as any]) });

    const program = new Command();
    program.exitOverride();
    registerCommitCommand(program, deps as any);

    await expect(
        program.parseAsync(['node', 'atom', 'commit', '--subject', 'test'])
    ).rejects.toThrow('Validation failed');

    expect(gitClient.commit).not.toHaveBeenCalled();
  });

  it('should proceed with commit but log warnings if validation returns warnings only', async () => {
    const gitClient = makeMockGitClient();
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as any;
    const protocol = makeMockProtocolContext({
        validateState: vi.fn().mockReturnValue([{ severity: 'warning', rule: 'test-warn', message: 'Hygiene issue' }])
    });
    const deps = createDeps({ gitClient, protocol, protocolRegistry: makeProtocolRegistry([protocol as any]), logger });

    const program = new Command();
    program.exitOverride();
    registerCommitCommand(program, deps as any);

    await program.parseAsync(['node', 'atom', 'commit', '--subject', 'test']);

    expect(gitClient.commit).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Hygiene issue');
  });
});
