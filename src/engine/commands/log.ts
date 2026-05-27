import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { SupersessionResolver } from '../services/supersession-resolver.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { Atom, SupersessionStatus } from '../types/domain.js';
import type { PathQueryOptions, SearchOptions, QueryResult } from '../types/query.js';
import type { FormattableQueryResult } from '../types/output.js';
import { buildQueryMeta } from './helpers/build-query-meta.js';
import { addPathQueryOptions } from './helpers/path-query.js';
import type { IGitClient } from '../interfaces/git-client.js';
import { mergeOptions } from './helpers/merge-options.js';
import type { ILogger } from '../interfaces/logger.js';

/**
 * Register the log command.
 * atom-enriched git log.
 * Accepts paths as arguments and routes to the appropriate repository method.
 */
export function registerLogCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    gitClient: IGitClient;
    supersessionResolver: SupersessionResolver;
    getFormatter: () => IOutputFormatter;
    logger: ILogger;
  },
): void {
  const cmd = program
    .command('log [paths...]')
    .description('Decision-enriched git log');

  // addPathQueryOptions adds --scope, --follow, --all, --author, --limit, --max-commits, --since, --until
  addPathQueryOptions(cmd);

  cmd.action(async (paths: string[] | undefined, _options: any, command: Command) => {
    const options = mergeOptions<PathQueryOptions>(command);
    const { atomRepository, gitClient, supersessionResolver, getFormatter, logger } = deps;

    // Resolve HEAD for caching
    let headHash: string | undefined;
    try {
      headHash = await gitClient.resolveRef('HEAD');
    } catch {
      // Ignore if not in repo
    }

    let atoms: Atom[];

    if (paths && paths.length > 0) {
      // Case A: Paths provided - route to findByTarget
      const gitLogArgs = ['--', ...paths];
      atoms = await atomRepository.findByTarget(gitLogArgs, options, headHash);
    } else {
      // Case B: No paths - route to findAll (global discovery)
      const findOptions: SearchOptions = {
        ...options,
      };
      atoms = await atomRepository.findAll(findOptions, headHash);
    }

    // Compute supersession status
    const globalSupersessionMap = supersessionResolver.resolveAll(atoms);
    
    // Flatten global map into a single map for the formatter (legacy text UI parity)
    const flatSupersessionMap = new Map<string, SupersessionStatus>();
    for (const statusMap of globalSupersessionMap.values()) {
        for (const [id, status] of statusMap) {
            flatSupersessionMap.set(id, status);
        }
    }

    const totalAtoms = atoms.length;

    // Filter active atoms unless --all is specified
    let displayAtoms: readonly Atom[];
    if (options.all) {
      displayAtoms = atoms;
    } else {
      displayAtoms = supersessionResolver.filterActive(atoms, globalSupersessionMap);
    }

    // Apply the display-level limit
    if (options.limit !== null && options.limit !== undefined && options.limit > 0) {
      displayAtoms = displayAtoms.slice(0, options.limit);
    }

    const result: QueryResult = {
      command: 'log',
      target: paths?.join(', ') || 'repository',
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
