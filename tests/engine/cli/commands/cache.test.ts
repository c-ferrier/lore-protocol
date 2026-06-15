import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerCacheCommand } from '../../../../src/engine/cli/commands/cache.js';
import { type MockedEngineInfra, MockedOutputFormatter } from '../../../mock-types.js';
import { makeMockInfra, TestLogger } from '../../engine-test-utils.js';

describe('Engine registerCacheCommand', () => {
  let infra: MockedEngineInfra;
  let logger: TestLogger;
  let formatter: MockedOutputFormatter;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new TestLogger();
    formatter = {
      formatSuccess: vi.fn((msg) => `SUCCESS: ${msg}`),
      formatError: vi.fn((_code, msgs) => `ERROR: ${msgs[0].message}`),
    } as unknown as MockedOutputFormatter;

    infra = makeMockInfra({
      getFormatter: vi.fn(() => formatter),
      logger,
    });
  });

  it('should clear caches when --clean is used', async () => {
    const program = new Command();
    registerCacheCommand(program, infra);

    await program.parseAsync(['node', 'test', 'cache', '--clean']);

    expect(infra.cache.clear).toHaveBeenCalled();
    expect(infra.identityIndex.clear).toHaveBeenCalled();
    expect(logger.infoLogs[0]).toContain('Successfully cleared local identity index and query caches.');
  });

  it('should prune caches when --prune is used', async () => {
    const program = new Command();
    registerCacheCommand(program, infra);
    
    infra.git.resolveRef.mockResolvedValue('abcd1234');

    await program.parseAsync(['node', 'test', 'cache', '--prune']);

    expect(infra.git.resolveRef).toHaveBeenCalledWith('HEAD');
    expect(infra.cache.prune).toHaveBeenCalledWith(['abcd1234']);
    expect(logger.infoLogs[0]).toContain('Successfully pruned query cache');
  });

  it('should handle errors during pruning', async () => {
    const program = new Command();
    registerCacheCommand(program, infra);
    
    infra.git.resolveRef.mockRejectedValue(new Error('Git fail'));

    await program.parseAsync(['node', 'test', 'cache', '--prune']);

    expect(logger.errors[0]).toContain('Failed to prune cache: Git fail');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0; // Reset for other tests
  });
});
