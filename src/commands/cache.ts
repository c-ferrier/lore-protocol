import type { Command } from 'commander';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { IQueryCache } from '../interfaces/query-cache.js';
import { rm } from 'node:fs/promises';

/**
 * Register the `lore cache` command.
 * Provides management utilities for the local sharded cache.
 */
export function registerCacheCommand(
  program: Command,
  deps: {
    getFormatter: () => IOutputFormatter;
    cacheDir: string;
    queryCache: IQueryCache;
  },
): void {
  program
    .command('cache')
    .description('Manage the local Lore cache')
    .option('--clean', 'Clear all cached atom and query data')
    .option('--prune', 'Prune old query cache entries to free up space')
    .action(async (options) => {
      const formatter = deps.getFormatter();

      if (options.clean) {
        try {
          await rm(deps.cacheDir, { recursive: true, force: true });
          console.log(formatter.formatSuccess('Successfully cleared local cache.'));
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(formatter.formatError(1, [{ severity: 'error', message: `Failed to clear cache: ${message}` }]));
          process.exitCode = 1;
          return;
        }
        return;
      }

      if (options.prune) {
        try {
          await deps.queryCache.prune();
          console.log(formatter.formatSuccess('Successfully pruned query cache.'));
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(formatter.formatError(1, [{ severity: 'error', message: `Failed to prune cache: ${message}` }]));
          process.exitCode = 1;
          return;
        }
        return;
      }

      // If no options are provided, show help
      program.commands.find(c => c.name() === 'cache')?.help();
    });
}
