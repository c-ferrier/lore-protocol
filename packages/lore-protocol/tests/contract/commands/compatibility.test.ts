import * as engineExports from '@c-ferrier/atom-engine';
import { type PathQueryDeps } from '@c-ferrier/atom-engine';
import { Command } from 'commander';
import { beforeEach,describe, expect, it, vi } from 'vitest';

import { registerConstraintsCommand } from '../../../src/commands/constraints.js';
import { registerContextCommand } from '../../../src/commands/context.js';
import { makeMockLoreInfra } from '../../lore-test-utils.js';

describe('Lore Compatibility Command Registration', () => {
  let program: Command;
  let deps: PathQueryDeps;

  beforeEach(() => {
    program = new Command();
    deps = makeMockLoreInfra();
    
    // Spy on the shared helper
    vi.spyOn(engineExports, 'executePathQuery').mockResolvedValue(undefined);
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
    
    expect(engineExports.executePathQuery).toHaveBeenCalledWith(
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
    
    expect(engineExports.executePathQuery).toHaveBeenCalledWith(
      'src/',
      expect.any(Object),
      deps,
      'constraints',
      ['Constraint']
    );
  });
});