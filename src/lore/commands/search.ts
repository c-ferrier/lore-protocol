import { type Command } from 'commander';

import { addPathQueryOptions, executePathQuery, type PathQueryCommandOptions } from '../../engine/cli/commands/helpers/path-query.js';
import { type EngineInfra } from '../../engine/services/engine-bootstrapper.js';

/**
 * Register the `search` command.
 * Lore-specific alias for global chronological surveying.
 */
export function registerSearchCommand(
  program: Command,
  infra: EngineInfra,
): void {
  const cmd = program
    .command('search')
    .description('Search for decision atoms across history');

  addPathQueryOptions(cmd);

  cmd.action(async (options: PathQueryCommandOptions) => {
    await executePathQuery(undefined, options, infra, 'search', 'all');
  });
}
