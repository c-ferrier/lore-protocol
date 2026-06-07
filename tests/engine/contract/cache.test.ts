import { join } from 'node:path';

import { Command } from 'commander';
import { beforeEach,describe, expect, it, vi } from 'vitest';

import { registerCacheCommand } from '../../../src/engine/cli/commands/cache.js';
import { TestLogger } from '../engine-test-utils.js';

describe('Cache Command', () => {
  const mockFormatter = {
    formatSuccess: vi.fn((m) => m),
    formatError: vi.fn((code, msgs) => msgs[0].message),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register the cache command with clean option', () => {
    const program = new Command();
    const logger = new TestLogger();
    registerCacheCommand(
      program, 
      {
        getFormatter: () => mockFormatter as any,
        logger,
      },
      join(process.cwd(), '.atom', 'cache')
    );

    const cacheCmd = program.commands.find(c => c.name() === 'cache');
    expect(cacheCmd).toBeDefined();
    expect(cacheCmd?.options.find(o => o.long === '--clean')).toBeDefined();
  });
});