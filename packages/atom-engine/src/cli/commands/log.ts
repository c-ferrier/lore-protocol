import type { Command } from 'commander';

import type { EngineInfra } from '../../services/engine-bootstrapper.js';
// Pure Logic Modules
import { addPathQueryOptions, executePathQuery, type PathQueryCommandOptions } from './helpers/path-query.js';

/**
 * Register the log command.
 * Standardizes git-history based surveyor across all protocols.
 */
export function registerLogCommand(
  program: Command,
  infra: EngineInfra,
): void {
  const cmd = program
    .command('log [paths...]')
    .description('Chronological decision surveyors for specific paths');

  addPathQueryOptions(cmd);

  cmd.action(async (paths: string[] | undefined, options: PathQueryCommandOptions) => {
    // Lore 0.5.0 Parity: 'log' defaults to showing all atoms (including superseded).
    // Other path queries (constraints, rejected, etc.) default to Active Truth.
    const logOptions = { ...options, all: options.all ?? true };
    await executePathQuery(paths, logOptions, infra, 'log', 'all');
  });
}
