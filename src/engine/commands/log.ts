import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { SupersessionResolver } from '../services/supersession-resolver.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { Config } from '../types/config.js';
import type { Atom, SupersessionStatus } from '../types/domain.js';
import type { PathQueryOptions, SearchOptions, QueryResult } from '../types/query.js';
import type { FormattableQueryResult } from '../types/output.js';
import { buildQueryMeta } from './helpers/build-query-meta.js';
import { addPathQueryOptions } from './helpers/path-query.js';
import type { IProtocol } from '../interfaces/protocol.js';
import type { IGitClient } from '../interfaces/git-client.js';
import { mergeOptions } from './helpers/merge-options.js';

/**
 * Register the log command.
 * Lore-enriched git log.
 * Accepts paths as arguments and routes to the appropriate repository method.
 */
export function registerLogCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    gitClient: IGitClient;
    supersessionResolver: SupersessionResolver;
    getFormatter: () => IOutputFormatter;
    config: Config;
    protocol: IProtocol | undefined;
  },
): void {
  const protocolName = deps.protocol?.name || 'Atom';
  const cmd = program
    .command('log [paths...]')
    .description(`${protocolName}-enriched git log`);
;

  // addPathQueryOptions adds --scope, --follow, --all, --author, --limit, --max-commits, --since, --until
  addPathQueryOptions(cmd);

  cmd.action(async (paths: string[] | undefined, _options: any, command: Command) => {
    const options = mergeOptions<PathQueryOptions>(command);
    const { atomRepository, gitClient, supersessionResolver, getFormatter } = deps;

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
    const supersessionMap: Map<string, SupersessionStatus> = supersessionResolver.resolve(atoms);

    const totalAtoms = atoms.length;

    // Filter active atoms unless --all is specified
    let displayAtoms: readonly Atom[];
    if (options.all) {
      displayAtoms = atoms;
    } else {
      displayAtoms = supersessionResolver.filterActive(atoms, supersessionMap);
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
      supersessionMap,
      visibleTrailers: 'all',
    };

    const formatter = getFormatter();
    console.log(formatter.formatQueryResult(formattable));
  });
}
