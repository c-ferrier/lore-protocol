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
  },
): void {
  const cmd = program
    .command('log [paths...]')
    .description('Chronological decision surveyors for specific paths');

  addPathQueryOptions(cmd);

  cmd.action(async (paths: string[] | undefined, _options: any, command: Command) => {
    const options = mergeOptions<PathQueryOptions>(command);
    const { atomRepository, supersessionResolver, getFormatter, logger } = deps;

    // Step 1: Query atoms using the high-level repository API
    // This encapsulates Path resolution, Git-log construction, and Caching.
    let atoms: Atom[];
    let targetDisplay: string;

    if (options.scope) {
      atoms = await atomRepository.findByScope(options.scope, options);
      targetDisplay = `scope:${options.scope}`;
    } else if (paths && paths.length > 0) {
      atoms = await atomRepository.findAtoms(paths, options);
      targetDisplay = paths.join(', ');
    } else {
      atoms = await atomRepository.findAll(options);
      targetDisplay = 'all';
    }

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
      target: targetDisplay,
      targetType: paths && paths.length > 0 ? 'directory' : 'global',
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
