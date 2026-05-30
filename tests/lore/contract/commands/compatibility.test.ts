import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerContextCommand } from '../../../../src/lore/commands/context.js';
import { registerConstraintsCommand } from '../../../../src/lore/commands/constraints.js';
import * as pathQuery from '../../../../src/engine/commands/helpers/path-query.js';

describe('Lore Compatibility Command Registration', () => {
  let program: Command;
  let deps: any;

  beforeEach(() => {
    program = new Command();
    deps = {
      atomRepository: {},
      gitClient: {},
      supersessionResolver: {},
      getFormatter: vi.fn(),
      config: {},
      protocol: { name: 'Lore' }
    };
    
    // Spy on the shared helper
    vi.spyOn(pathQuery, 'executePathQuery').mockResolvedValue(undefined);
  });

  it('context command should pass all CLI options to the engine', async () => {
    registerContextCommand(program, deps);
    const cmd = program.commands.find(c => c.name() === 'context')!;
    
    await cmd.parseAsync([
      'src/',
      '--limit', '10',
      '--since', 'main',
      '--author', 'cole@example.com',
      '--all'
    ], { from: 'user' });
    
    expect(pathQuery.executePathQuery).toHaveBeenCalledWith(
      'src/',
      expect.objectContaining({
        limit: 10,
        since: 'main',
        author: 'cole@example.com',
        all: true
      }),
      deps,
      'context',
      'all'
    );
  });

  it('constraints command should pass specific trailers to the engine', async () => {
    registerConstraintsCommand(program, deps);
    const cmd = program.commands.find(c => c.name() === 'constraints')!;
    
    await cmd.parseAsync(['src/'], { from: 'user' });
    
    expect(pathQuery.executePathQuery).toHaveBeenCalledWith(
      'src/',
      expect.any(Object),
      deps,
      'constraints',
      ['Constraint']
    );
  });
});
