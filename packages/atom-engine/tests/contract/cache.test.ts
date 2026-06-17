
import { Command } from 'commander';
import { beforeEach,describe, expect, it, vi } from 'vitest';

import { registerCacheCommand } from '../../src/cli/commands/cache.js';
import { makeMockFormatter,makeMockInfra,TestLogger } from '../engine-test-utils.js';
import { type MockedOutputFormatter } from '../mock-types.js';

describe('Cache Command', () => {
  let mockFormatter: MockedOutputFormatter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFormatter = makeMockFormatter();
  });

  it('should register the cache command with clean option', () => {
    const program = new Command();
    const logger = new TestLogger();
    const infra = makeMockInfra({
        getFormatter: () => mockFormatter,
        logger,
    });
    registerCacheCommand(
      program, 
      infra
    );

    const cacheCmd = program.commands.find(c => c.name() === 'cache');
    expect(cacheCmd).toBeDefined();
    expect(cacheCmd?.options.find(o => o.long === '--clean')).toBeDefined();
  });
});