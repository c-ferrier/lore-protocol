import { 
    addPathQueryOptions, 
    executePathQuery, 
    type PathQueryCommandOptions } from '@c-ferrier/atom-engine';
import { type EngineInfra } from '@c-ferrier/atom-engine';
import { type Command } from 'commander';

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
