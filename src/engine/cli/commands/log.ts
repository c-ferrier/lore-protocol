import type { Command } from 'commander';

// Pure Logic Modules
import { createQueryTarget } from '../../core/logic/query-targets.js';
import type { FormattableQueryResult } from '../../core/types/output.js';
import type { QueryResult } from '../../core/types/query.js';
import type { EngineInfra } from '../../services/engine-bootstrapper.js';
import { findAtoms } from '../../shell/orchestrators/discovery.js';
import { buildQueryMeta } from './helpers/build-query-meta.js';
import { mergeOptions } from './helpers/merge-options.js';
import { addPathQueryOptions, type PathQueryCommandOptions } from './helpers/path-query.js';

/**
 * Register the log command.
 * Standardizes git-history based surveyor across all protocols.
 */
export function registerLogCommand(
  program: Command,
  infra: EngineInfra,
): void {
  const { protocolRoot, cwd } = infra;
  const cmd = program
    .command('log [paths...]')
    .description('Chronological decision surveyors for specific paths');

  addPathQueryOptions(cmd);

  cmd.action(async (paths: string[] | undefined, _options: PathQueryCommandOptions, command: Command) => {
    const options = mergeOptions<PathQueryCommandOptions>(command);
    const { getFormatter, logger } = infra;

    // Step 1: Resolve target using the pure logic
    const target = createQueryTarget(options.scope ? undefined : paths, { 
        cwd, 
        protocolRoot, 
        isScoped: !!options.scope 
    });

    const atoms = await findAtoms(infra, target, { ...options, includeAllCommits: options.history });
    const totalAtoms = atoms.length;

    // Step 2: Apply the display-level limit
    let displayAtoms = atoms;
    if (options.limit !== null && options.limit !== undefined && options.limit > 0) {
      displayAtoms = displayAtoms.slice(0, options.limit);
    }

    const result: QueryResult = {
      command: 'log',
      target: target.raw ? target.raw.toString() : 'all',
      targetType: target.type === 'global' ? 'global' : 'path',
      atoms: displayAtoms,
      meta: buildQueryMeta(totalAtoms, displayAtoms),
    };

    const formattable: FormattableQueryResult = {
      result,
      visibleTrailers: 'all',
    };

    const formatter = getFormatter();
    logger.result(formatter.formatQueryResult(formattable));
  });
}
