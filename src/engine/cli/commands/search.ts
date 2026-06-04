import type { Command } from 'commander';
import type { Atom, SupersessionStatus } from '../../core/types/domain.js';
import type { QueryResult } from '../../core/types/query.js';
import type { FormattableQueryResult } from '../../core/types/output.js';
import { buildQueryMeta } from './helpers/build-query-meta.js';
import { addPathQueryOptions, type PathQueryCommandOptions } from './helpers/path-query.js';
import { mergeOptions } from './helpers/merge-options.js';
import type { AtomRepository } from '../../services/atom-repository.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { ILogger } from '../../interfaces/logger.js';

// Pure Logic Modules
import { createQueryTarget } from '../../core/logic/query-targets.js';

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
    gitRoot: string;
    cwd: string;
  },
): void {
  const { protocolRoot, gitRoot, cwd } = deps;
  const cmd = program
    .command('search')
    .description('Search for decision atoms across history')
    .option('--text <query>', 'Search commit subjects and bodies')
    .option('--has <key>', 'Search for atoms containing a specific trailer key');

  addPathQueryOptions(cmd);

  cmd.action(async (options: PathQueryCommandOptions & { text?: string; has?: string }, command: Command) => {
    const { atomRepository, getFormatter, logger } = deps;
    const mergedOptions = mergeOptions<PathQueryCommandOptions & { text?: string; has?: string }>(command);

    const searchOptions = {
      filters: mergedOptions.filter && mergedOptions.filter.length > 0 ? mergedOptions.filter : undefined,
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

    // Step 1: Resolve target using the pure logic
    const target = createQueryTarget(undefined, { 
        cwd, 
        protocolRoot, 
        isScoped: !!searchOptions.scope 
    });

    const atoms = await atomRepository.find(target, searchOptions);
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
