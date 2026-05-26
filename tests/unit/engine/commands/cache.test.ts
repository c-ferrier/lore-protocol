import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerCacheCommand } from '../../../../src/engine/commands/cache.js';
import { join } from 'node:path';

describe('Cache Command', () => {
  const mockFormatter = {
    formatSuccess: vi.fn((m) => m),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register the cache command with clean option', () => {
    const program = new Command();
    registerCacheCommand(program, {
      getFormatter: () => mockFormatter as any,
      cacheDir: join(process.cwd(), '.atom', 'cache'),
    });

    const cacheCmd = program.commands.find(c => c.name() === 'cache');
    expect(cacheCmd).toBeDefined();
    expect(cacheCmd?.options.find(o => o.long === '--clean')).toBeDefined();
  });
});
