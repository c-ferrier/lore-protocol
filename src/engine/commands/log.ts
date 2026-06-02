import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { SupersessionResolver } from '../services/supersession-resolver.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { Atom, SupersessionStatus } from '../types/domain.js';
import type { PathQueryOptions, QueryResult } from '../types/query.js';
import type { FormattableQueryResult } from '../types/output.js';
import { buildQueryMeta } from './helpers/build-query-meta.js';
import { addPathQueryOptions } from './helpers/path-query.js';
import { mergeOptions } from './helpers/merge-options.js';
import type { ILogger } from '../interfaces/logger.js';

import type { QueryTargetFactory } from '../services/query-target-factory.js';

/**
 * Register the log command.
 * Standardizes git-history based surveyor across all protocols.
 */
export function registerLogCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    supersessionResolver: SupersessionResolver;
    getFormatter: () => IOutputFormatter;
    logger: ILogger;
    targetFactory: QueryTargetFactory;
  },
): void {
  const cmd = program
    .command('log [paths...]')
    .description('Chronological decision surveyors for specific paths');

  addPathQueryOptions(cmd);

  cmd.action(async (paths: string[] | undefined, _options: any, command: Command) => {
    const options = mergeOptions<PathQueryOptions>(command);
    const { atomRepository, supersessionResolver, getFormatter, logger, targetFactory } = deps;

    // Step 1: Resolve target using the opaque factory
    const target = options.scope 
      ? targetFactory.create() // Scopes use the base target logic
      : targetFactory.create(paths);

    const atoms = await atomRepository.find(target, options);
    const totalAtoms = atoms.length;

    // Step 2: Compute supersession status
    const globalSupersessionMap = supersessionResolver.resolveAll(atoms);
    
    // Flatten global map into a single map for the formatter (legacy text UI parity)
    const flatSupersessionMap = new Map<string, SupersessionStatus>();
    for (const statusMap of globalSupersessionMap.values()) {
        for (const [id, status] of statusMap) {
            flatSupersessionMap.set(id, status);
        }
    }

    // Step 3: Filter superseded atoms unless --all
    let displayAtoms: readonly Atom[];
    if (options.all === false) {
      displayAtoms = supersessionResolver.filterActive(atoms, globalSupersessionMap);
    } else {
      displayAtoms = atoms;
    }

    // Step 4: Apply the display-level limit
    if (options.limit !== null && options.limit !== undefined && options.limit > 0) {
      displayAtoms = displayAtoms.slice(0, options.limit);
    }

    const result: QueryResult = {
      command: 'log',
      target: target.raw ? target.raw.toString() : 'all',
      targetType: target.type === 'global' ? 'global' : 'directory',
      atoms: displayAtoms,
      meta: buildQueryMeta(totalAtoms, displayAtoms),
    };

    const formattable: FormattableQueryResult = {
      result,
      supersessionMap: flatSupersessionMap,
      visibleTrailers: 'all',
    };

    const formatter = getFormatter();
    logger.result(formatter.formatQueryResult(formattable));
  });
}
