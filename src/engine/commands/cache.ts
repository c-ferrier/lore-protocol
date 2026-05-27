import type { Command } from 'commander';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import { rm } from 'node:fs/promises';
import type { ILogger } from '../interfaces/logger.js';

/**
 * Register the ` cache` command.
 * Provides management utilities for the local sharded cache.
 */
export function registerCacheCommand(
  program: Command,
  deps: {
    getFormatter: () => IOutputFormatter;
    cacheDir: string;
    logger: ILogger;
  },
): void {
  program
    .command('cache')
    .description('Manage the local protocol cache')
    .option('--clean', 'Clear all cached atom and query data')
    .action(async (options) => {
      const formatter = deps.getFormatter();

      if (options.clean) {
        try {
          await rm(deps.cacheDir, { recursive: true, force: true });
          deps.logger.info(formatter.formatSuccess('Successfully cleared local atom and query caches.'));
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          deps.logger.error(formatter.formatError(1, [{ severity: 'error', message: `Failed to clear cache: ${message}` }]));
          process.exitCode = 1;
          return;
        }
        return;
      }

      // If no options are provided, show help
      program.commands.find(c => c.name() === 'cache')?.help();
    });
}
