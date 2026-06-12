import type { Command } from 'commander';

import type { EngineInfra } from '../../services/engine-bootstrapper.js';
// Pure Logic Modules
import { addPathQueryOptions, executePathQuery, type PathQueryCommandOptions } from './helpers/path-query.js';

/**
 * Register the `why <target>` command.
 * Target must be `file:line` or `file:line-line` format.
 */
export function registerWhyCommand(
  program: Command,
  infra: EngineInfra,
): void {
  const cmd = program
    .command('why <target>')
    .description('Decision context for a specific line or line range');

  addPathQueryOptions(cmd);

  cmd.action(async (target: string, options: PathQueryCommandOptions) => {
    // 'why' defaults to showing all atoms (including superseded) to provide full context.
    const whyOptions = { ...options, all: options.all ?? true };
    await executePathQuery(target, whyOptions, infra, 'why', 'all');
  });
}
