import { 
    addPathQueryOptions, 
    executePathQuery, 
    mergeOptions, 
    type PathQueryCommandOptions,
    type PathQueryDeps} from '@c-ferrier/atom-engine';
import type { Command } from 'commander';

/**
 * Register the `lore context <target>` command.
 * Full lore summary showing ALL trailer types.
 */
export function registerContextCommand(
  program: Command,
  deps: PathQueryDeps,
): void {
  const cmd = program
    .command('context <target>')
    .description('Full lore summary for a code region');

  addPathQueryOptions(cmd);

  cmd.action(async (target: string, _options: PathQueryCommandOptions, command: Command) => {
    const options = mergeOptions<PathQueryCommandOptions>(command);
    await executePathQuery(target, options, deps, 'context', 'all');
  });
}
