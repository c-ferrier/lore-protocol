import { rm } from 'node:fs/promises';

import type { Command } from 'commander';

import type { EngineInfra } from '../../services/engine-bootstrapper.js';

/**
 * Register the ` cache` command.
 * Provides management utilities for the local sharded cache.
 */
export function registerCacheCommand(
  program: Command,
  infra: EngineInfra,
  cacheDir: string
): void {
  program
    .command('cache')
    .description('Manage the local protocol cache')
    .option('--clean', 'Clear all cached atom and query data')
    .action(async (options) => {
      const { getFormatter, logger } = infra;
      const formatter = getFormatter();

      if (options.clean) {
        try {
          await rm(cacheDir, { recursive: true, force: true });
          logger.info(formatter.formatSuccess('Successfully cleared local atom and query caches.'));
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(formatter.formatError(1, [{ severity: 'error', message: `Failed to clear cache: ${message}` }]));
          process.exitCode = 1;
          return;
        }
        return;
      }

      // If no options are provided, show help
      program.commands.find(c => c.name() === 'cache')?.help();
    });
}
