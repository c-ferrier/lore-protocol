import type { Command } from 'commander';

// Pure Logic Modules
import { createQueryTarget } from '../../core/logic/query-targets.js';
import type { Atom } from '../../core/types/domain.js';
import type { FormattableQueryResult } from '../../core/types/output.js';
import type { QueryOptions,QueryResult } from '../../core/types/query.js';
import type { ILogger } from '../../interfaces/logger.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { AtomRepository } from '../../services/atom-repository.js';
import { buildQueryMeta } from './helpers/build-query-meta.js';
import { mergeOptions } from './helpers/merge-options.js';
import { addPathQueryOptions, type PathQueryCommandOptions } from './helpers/path-query.js';

/**
 * Register the `search` command.
 */
export function registerSearchCommand(
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
    .command('search')
    .description('Search for decision atoms across history');

  addPathQueryOptions(cmd);

  cmd.action(async (_options: PathQueryCommandOptions, command: Command) => {
    const { atomRepository, getFormatter, logger } = deps;
    const options = mergeOptions<PathQueryCommandOptions>(command);

    const searchOptions: QueryOptions = {
      filters: options.filter && options.filter.length > 0 ? options.filter : [],
      scope: options.scope ?? null,
      follow: options.follow ?? false,
      all: options.all ?? false,
      author: options.author ?? null,
      limit: options.limit ?? null,
      maxCommits: options.maxCommits ?? null,
      since: options.since ?? null,
      until: options.until ?? null,
      text: options.text ?? null,
      has: options.has ?? null,
    };

    // Step 1: Resolve target using the pure logic
    const target = createQueryTarget(undefined, { 
        cwd, 
        protocolRoot, 
        isScoped: !!searchOptions.scope 
    });

    const atoms = await atomRepository.find(target, { ...searchOptions, includeAllCommits: !!options.history });
    const totalAtoms = atoms.length;

    // Step 3: Filter superseded atoms unless --all (Active Truth)
    let displayAtoms: readonly Atom[];
    if (searchOptions.all) {
      displayAtoms = atoms;
    } else {
      displayAtoms = atoms.filter(atom => {
          for (const state of atom.protocols.values()) {
              if (state.supersession?.superseded) return false;
          }
          return true;
      });
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
      visibleTrailers: 'all',
    };

    const formatter = getFormatter();
    logger.result(formatter.formatQueryResult(formattable));
  });
}
