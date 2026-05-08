import type { Command } from 'commander';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_DIR } from '../util/constants.js';

/**
 * Register the `lore cache` command.
 * Provides management utilities for the local sharded cache.
 */
export function registerCacheCommand(
  program: Command,
  deps: {
    getFormatter: () => IOutputFormatter;
  },
): void {
  program
    .command('cache')
    .description('Manage the local Lore cache')
    .option('--clean', 'Clear all cached atom and query data')
    .action(async (options) => {
      const formatter = deps.getFormatter();

      if (options.clean) {
        const cacheDir = join(process.cwd(), CONFIG_DIR, 'cache');
        
        try {
          await rm(cacheDir, { recursive: true, force: true });
          console.log(formatter.formatSuccess('Successfully cleared local cache.'));
        } catch (error: any) {
          console.error(formatter.formatError(1, [{ severity: 'error', message: `Failed to clear cache: ${error.message}` }]));
          process.exit(1);
        }
        return;
      }

      // If no options are provided, show help
      program.commands.find(c => c.name() === 'cache')?.help();
    });
}
