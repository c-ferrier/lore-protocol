import type { Command } from 'commander';
import type { Atom, SupersessionStatus } from '../types/domain.js';
import type { QueryResult } from '../types/query.js';
import type { FormattableQueryResult } from '../types/output.js';
import { buildQueryMeta } from './helpers/build-query-meta.js';
import { addPathQueryOptions, type PathQueryCommandOptions } from './helpers/path-query.js';
import { mergeOptions } from './helpers/merge-options.js';
import type { AtomRepository } from '../services/atom-repository.js';
import type { SupersessionResolver } from '../services/supersession-resolver.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { ILogger } from '../interfaces/logger.js';

/**
 * Register the `search` command.
 */
export function registerSearchCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    supersessionResolver: SupersessionResolver;
    getFormatter: () => IOutputFormatter;
    logger: ILogger;
  },
): void {
  const cmd = program
    .command('search')
    .description('Search for decision atoms across history')
    .option('--text <query>', 'Search commit subjects and bodies')
    .option('--has <key>', 'Search for atoms containing a specific trailer key');

  addPathQueryOptions(cmd);

  cmd.action(async (options: PathQueryCommandOptions & { text?: string; has?: string }, command: Command) => {
    const { atomRepository, supersessionResolver, getFormatter, logger } = deps;
    const mergedOptions = mergeOptions<PathQueryCommandOptions & { text?: string; has?: string }>(command);

    const searchOptions = {
      scope: mergedOptions.scope ?? null,
      follow: mergedOptions.follow ?? false,
      all: mergedOptions.all ?? false,
      author: mergedOptions.author ?? null,
      limit: mergedOptions.limit ?? null,
      maxCommits: mergedOptions.maxCommits ?? null,
      since: mergedOptions.since ?? null,
      until: mergedOptions.until ?? null,
      text: mergedOptions.text ?? null,
      has: mergedOptions.has ?? null,
    };

    // Step 1: Perform High-Level Search (Encapsulated in Repository)
    const atoms = await atomRepository.find(searchOptions);
    const totalAtoms = atoms.length;

    // Step 2: Compute supersession
    const globalSupersessionMap = supersessionResolver.resolveAll(atoms);

    // Flatten global map for formatter
    const flatSupersessionMap = new Map<string, SupersessionStatus>();
    for (const statusMap of globalSupersessionMap.values()) {
        for (const [id, status] of statusMap) {
            flatSupersessionMap.set(id, status);
        }
    }

    // Step 3: Filter superseded atoms unless --all
    let displayAtoms: readonly Atom[];
    if (searchOptions.all) {
      displayAtoms = atoms;
    } else {
      displayAtoms = supersessionResolver.filterActive(atoms, globalSupersessionMap);
    }

    // Step 4: Apply result limit
    if (searchOptions.limit !== null && searchOptions.limit !== undefined && searchOptions.limit > 0) {
      displayAtoms = displayAtoms.slice(0, searchOptions.limit);
    }

    const result: QueryResult = {
      command: 'search',
      target: 'global',
      targetType: 'search',
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
