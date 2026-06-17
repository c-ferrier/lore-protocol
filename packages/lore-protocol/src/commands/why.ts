import { 
    addPathQueryOptions, 
    executePathQuery, 
    type PathQueryCommandOptions } from '@c-ferrier/atom-engine';
import { type EngineInfra } from '@c-ferrier/atom-engine';
import { type Command } from 'commander';

/**
 * Register the `why <target>` command.
 * Lore-specific alias for line-range decision surveying.
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
