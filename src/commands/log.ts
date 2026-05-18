import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { SupersessionResolver } from '../services/supersession-resolver.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { QueryOptions, QueryResult } from '../types/query.js';
import type { LoreAtom } from '../types/domain.js';
import type { FormattableQueryResult } from '../types/output.js';
import { mergeOptions } from './helpers/merge-options.js';
import { buildQueryMeta } from './helpers/build-query-meta.js';
import { parsePositiveInt } from './helpers/path-query.js';

interface LogCommandOptions {
  readonly limit?: number;
  readonly page?: number;
  readonly maxCommits?: number;
  readonly since?: string;
}

/**
 * Register the `lore log` command.
 * Lore-enriched git log. Shows all Lore-enriched commits in reverse
 * chronological order. Path arguments after `--` are passed through.
 */
export function registerLogCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    supersessionResolver: SupersessionResolver;
    getFormatter: () => IOutputFormatter;
  },
): void {
  program
    .command('log [paths...]')
    .description('Lore-enriched git log')
    .option('--limit <n>', 'Maximum number of results to display', parsePositiveInt)
    .option('--page <n>', 'Page number for pagination', parsePositiveInt)
    .option('--max-commits <n>', 'Maximum git commits to scan (supersession may be incomplete)', parsePositiveInt)
    .option('--since <ref>', 'Only consider commits since ref/date')
    .action(async (paths: string[], _options: LogCommandOptions, command: Command) => {
      const options = mergeOptions<LogCommandOptions>(command);
      const { atomRepository, supersessionResolver, getFormatter } = deps;

      const queryOptions: QueryOptions = {
        since: options.since ?? null,
        until: null,
        maxCommits: options.maxCommits ?? null,
        author: null,
        scope: null,
        text: null,
        confidence: null,
        scopeRisk: null,
        reversibility: null,
        has: null,
        follow: false,
        followDepth: null,
        all: true, // Log traditionally shows everything
        limit: options.limit ?? null,
        page: options.page ?? null,
      };

      const { atoms: displayAtoms, totalCount, oldest, newest } = paths.length > 0
        ? await atomRepository.findByTarget(['--', ...paths], queryOptions)
        : await atomRepository.findAll(queryOptions);

      // Build supersession map (show everything, including superseded atoms)
      const supersessionMap = supersessionResolver.resolve(displayAtoms);

      const result: QueryResult = {
        command: 'log',
        target: paths.length > 0 ? paths.join(', ') : 'all',
        targetType: 'global',
        atoms: displayAtoms,
        meta: buildQueryMeta(totalCount, displayAtoms, { oldest, newest }),
        page: queryOptions.page ?? 1,
        limit: queryOptions.limit ?? displayAtoms.length,
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
