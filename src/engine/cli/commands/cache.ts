import type { Command } from 'commander';

import type { EngineInfra } from '../../services/engine-bootstrapper.js';

/**
 * Register the ` cache` command.
 * Provides management utilities for the local sharded cache.
 */
export function registerCacheCommand(
  program: Command,
  infra: EngineInfra,
): void {
  program
    .command('cache')
    .description('Manage the local caches')
    .option('--clean', 'Clear the identity index and query caches')
    .action(async (options) => {
      const { getFormatter, logger, cache, identityIndex } = infra;
      const formatter = getFormatter();

      if (options.clean) {
        try {
          await cache.clear();
          await identityIndex.clear();
          logger.info(formatter.formatSuccess('Successfully cleared local identity index and query caches.'));
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

