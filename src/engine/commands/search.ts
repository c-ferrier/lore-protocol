import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { SupersessionResolver } from '../services/supersession-resolver.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { Atom, SupersessionStatus } from '../types/domain.js';
import type { SearchOptions, QueryResult } from '../types/query.js';
import type { FormattableQueryResult } from '../types/output.js';
import { mergeOptions } from './helpers/merge-options.js';
import { buildQueryMeta } from './helpers/build-query-meta.js';
import { parsePositiveInt } from './helpers/path-query.js';
import { ProtocolError } from '../../util/errors.js';
import type { SearchFilter } from '../services/search-filter.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { ProtocolRegistry } from '../services/protocol-registry.js';

interface SearchCommandOptions {
  readonly has?: string;
  readonly author?: string;
  readonly scope?: string;
  readonly text?: string;
  readonly since?: string;
  readonly until?: string;
  readonly limit?: number;
  readonly maxCommits?: number;
  readonly all?: boolean;
  readonly filters?: Record<string, string | string[]>;
}

/**
 * Register the search command.
 * Cross-cutting query with filters across all atoms.
 */
export function registerSearchCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    gitClient: IGitClient;
    supersessionResolver: SupersessionResolver;
    searchFilter: SearchFilter;
    getFormatter: () => IOutputFormatter;
    protocolRegistry: ProtocolRegistry;
  },
): void {
  program
    .command('search')
    .description('Search across all atoms with filters')
    .option('--has <trailer>', 'Filter atoms that contain this trailer type')
    .option('--author <email>', 'Filter by commit author')
    .option('--scope <name>', 'Filter by conventional commit scope')
    .option('--text <query>', 'Full-text search across subject, body, and trailer values')
    .option('--since <ref>', 'Only consider commits since ref/date')
    .option('--until <ref>', 'Upper time/revision bound')
    .option('--all', 'Include superseded entries')
    .option('--limit <n>', 'Maximum number of results to display', parsePositiveInt)
    .option('--max-commits <n>', 'Maximum git commits to scan (supersession may be incomplete)', parsePositiveInt)
    .action(async (_options: SearchCommandOptions, command: Command) => {
      const options = mergeOptions<SearchCommandOptions>(command);
      const { atomRepository, gitClient, supersessionResolver, searchFilter, getFormatter, protocolRegistry } = deps;

      // Resolve HEAD for caching
      let headHash: string | undefined;
      try {
        headHash = await gitClient.resolveRef('HEAD');
      } catch {
        // Ignore if not in repo
      }

      // Validate 'has' trailer key against protocol
      let authorizedHas: string | null = null;
      if (options.has) {
        for (const p of protocolRegistry.getAll()) {
          authorizedHas = p.authorize(options.has);
          if (authorizedHas) break;
        }
        if (!authorizedHas) {
          throw new ProtocolError(
            `'${options.has}' is not a valid trailer. In strict mode, only core or explicitly configured trailers can be searched.`,
            1,
          );
        }
      }

      const searchOptions: SearchOptions = {
        filters: options.filters || {},
        has: authorizedHas,
        author: options.author ?? null,
        scope: options.scope ?? null,
        text: options.text ?? null,
        since: options.since ?? null,
        until: options.until ?? null,
        limit: options.limit ?? null,
        maxCommits: options.maxCommits ?? null,
        follow: false,
        all: options.all ?? false,
      };

      // Get all atoms with date range and scan-level filters (Optimized via Git layer push-down)
      let atoms = await atomRepository.findAll(searchOptions, headHash);

      // Apply text search and absolute precision filters via SearchFilter service
      atoms = searchFilter.filter(atoms, searchOptions);

      // Compute supersession on full set so each atom's status is available to the formatter
      const globalSupersessionMap = supersessionResolver.resolveAll(atoms);

      // Flatten global map into a single map for the formatter
      const flatSupersessionMap = new Map<string, SupersessionStatus>();
      for (const statusMap of globalSupersessionMap.values()) {
          for (const [id, status] of statusMap) {
              flatSupersessionMap.set(id, status);
          }
      }

      const totalAtoms = atoms.length;

      // Filter superseded atoms unless --all
      let displayAtoms: readonly Atom[];
      if (options.all) {
        displayAtoms = atoms;
      } else {
        displayAtoms = supersessionResolver.filterActive(atoms, globalSupersessionMap);
      }

      // Apply result limit (--limit) after all filtering and supersession
      if (searchOptions.limit !== null && searchOptions.limit !== undefined && searchOptions.limit > 0) {
        displayAtoms = displayAtoms.slice(0, searchOptions.limit);
      }

      const result: QueryResult = {
        command: 'search',
        target: buildSearchTargetDescription(searchOptions),
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
      console.log(formatter.formatQueryResult(formattable));
    });
}

function buildSearchTargetDescription(options: SearchOptions): string {
  const parts: string[] = [];

  if (options.filters) {
    for (const [key, value] of Object.entries(options.filters)) {
      parts.push(`${key.toLowerCase()}=${String(value)}`);
    }
  }
  if (options.has) parts.push(`has=${options.has}`);
  if (options.author) parts.push(`author=${options.author}`);
  if (options.scope) parts.push(`scope=${options.scope}`);
  if (options.text) parts.push(`text="${options.text}"`);
  if (options.since) parts.push(`since=${options.since}`);
  if (options.until) parts.push(`until=${options.until}`);

  return parts.length > 0 ? parts.join(', ') : 'all';
}
