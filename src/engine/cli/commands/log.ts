import type { Command } from 'commander';

// Pure Logic Modules
import { createQueryTarget } from '../../core/logic/query-targets.js';
import type { FormattableQueryResult } from '../../core/types/output.js';
import type { QueryResult } from '../../core/types/query.js';
import type { ILogger } from '../../interfaces/logger.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { AtomRepository } from '../../services/atom-repository.js';
import { buildQueryMeta } from './helpers/build-query-meta.js';
import { mergeOptions } from './helpers/merge-options.js';
import { addPathQueryOptions, type PathQueryCommandOptions } from './helpers/path-query.js';

/**
 * Register the log command.
 * Standardizes git-history based surveyor across all protocols.
 */
export function registerLogCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    getFormatter: () => IOutputFormatter;
    logger: ILogger;
    protocolRoot: string;
    cwd: string;
  },
): void {
  const { protocolRoot, cwd } = deps;
  const cmd = program
    .command('log [paths...]')
    .description('Chronological decision surveyors for specific paths');

  addPathQueryOptions(cmd);

  cmd.action(async (paths: string[] | undefined, _options: any, command: Command) => {
    const options = mergeOptions<PathQueryCommandOptions>(command);
    const { atomRepository, getFormatter, logger } = deps;
    // // console.log('LOG OPTIONS:', JSON.stringify(options));

    // Step 1: Resolve target using the pure logic
    const target = createQueryTarget(options.scope ? undefined : paths, { 
        cwd, 
        protocolRoot, 
        isScoped: !!options.scope 
    });

    const atoms = await atomRepository.find(target, { ...options, includeAllCommits: options.history });
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
