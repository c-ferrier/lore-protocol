import type { Command } from 'commander';
import type { AtomRepository } from '../../services/atom-repository.js';
import type { SupersessionResolver } from '../../services/supersession-resolver.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { EngineConfig } from '../../types/config.js';
import type { Atom, SupersessionStatus } from '../../types/domain.js';
import type { PathQueryOptions, QueryResult, TargetType } from '../../types/query.js';
import type { FormattableQueryResult } from '../../types/output.js';
import { buildQueryMeta } from './build-query-meta.js';
import type { ILogger } from '../../interfaces/logger.js';
import { ProtocolError } from '../../util/errors.js';

/** Parse a CLI value as a strict positive integer; rejects non-numeric trailing chars. */
export function parsePositiveInt(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ProtocolError(`Expected a positive integer, got "${value}"`, 1);
  }
  const n = Number(value);
  if (n < 1) {
    throw new ProtocolError(`Expected a positive integer, got "${value}"`, 1);
  }
  return n;
}

export interface PathQueryDeps {
  readonly atomRepository: AtomRepository;
  readonly supersessionResolver: SupersessionResolver;
  readonly getFormatter: () => IOutputFormatter;
  readonly config: EngineConfig;
  readonly logger: ILogger;
}

export interface PathQueryCommandOptions {
  readonly scope?: string;
  readonly follow?: boolean;
  readonly all?: boolean;
  readonly author?: string;
  readonly limit?: number;
  readonly maxCommits?: number;
  readonly since?: string;
  readonly until?: string;
}

/**
 * Shared helper for path-scoped query commands (context, constraints, rejected,
 * directives, tested). Each command follows the same resolve -> query -> filter ->
 * format pipeline, differing only in which trailers are visible.
 *
 * GoF: Template Method (via composition, not inheritance).
 */
export async function executePathQuery(
  target: string,
  options: PathQueryCommandOptions,
  deps: PathQueryDeps,
  commandName: string,
  visibleTrailers: readonly string[] | 'all',
): Promise<void> {
  const { atomRepository, supersessionResolver, getFormatter, config, logger } = deps;

  const queryOptions: PathQueryOptions = {
    scope: options.scope ?? null,
    follow: options.follow ?? false,
    all: options.all ?? false,
    author: options.author ?? null,
    limit: options.limit ?? null,
    maxCommits: options.maxCommits ?? null,
    since: options.since ?? null,
    until: options.until ?? null,
  };

  // Step 1: Resolve target or use --scope using high-level Repository API
  let atoms: Atom[];
  let targetType: TargetType | 'search' | 'global';
  let targetDisplay: string;

  if (queryOptions.scope) {
    atoms = await atomRepository.findByScope(queryOptions.scope, { ...queryOptions, limit: null });
    targetType = 'global';
    targetDisplay = `scope:${queryOptions.scope}`;
  } else {
    // Encapsulates path resolution
    atoms = await atomRepository.findAtoms(target, { ...queryOptions, limit: null });
    targetType = 'directory'; 
    targetDisplay = target;
  }

  // Step 2: Follow links if requested
  if (queryOptions.follow && atoms.length > 0) {
    atoms = await atomRepository.resolveFollowLinks(atoms, config.follow.maxDepth);
  }

  const totalAtoms = atoms.length;

  // Step 3: Compute supersession
  const globalSupersessionMap = supersessionResolver.resolveAll(atoms);

  // Flatten global map into a single map for the formatter
  const flatSupersessionMap = new Map<string, SupersessionStatus>();
  for (const statusMap of globalSupersessionMap.values()) {
      for (const [id, status] of statusMap) {
          flatSupersessionMap.set(id, status);
      }
  }

  // Step 4: Filter superseded atoms unless --all
  let displayAtoms: readonly Atom[];
  if (queryOptions.all) {
    displayAtoms = atoms;
  } else {
    displayAtoms = supersessionResolver.filterActive(atoms, globalSupersessionMap);
  }

  // Step 4b: Apply result limit (--limit) after supersession filtering
  if (queryOptions.limit !== null && queryOptions.limit !== undefined && queryOptions.limit > 0) {
    displayAtoms = displayAtoms.slice(0, queryOptions.limit);
  }

  // Step 5: Build QueryResult
  const result: QueryResult = {
    command: commandName,
    target: targetDisplay,
    targetType,
    atoms: displayAtoms,
    meta: buildQueryMeta(totalAtoms, displayAtoms),
  };

  const formattable: FormattableQueryResult = {
    result,
    supersessionMap: flatSupersessionMap,
    visibleTrailers,
  };

  // Step 6: Format and output
  const formatter = getFormatter();
  logger.result(formatter.formatQueryResult(formattable));
}

/**
 * Add the standard path-scoped query options to a command.
 */
export function addPathQueryOptions(cmd: Command): Command {
  return cmd
    .option('--scope <name>', 'Filter by conventional commit scope instead of path')
    .option('--follow', 'Transitively follow Related/Supersedes/Depends-on links')
    .option('--all', 'Include superseded entries')
    .option('--author <email>', 'Filter by commit author')
    .option('--limit <n>', 'Maximum number of results to display', parsePositiveInt)
    .option('--max-commits <n>', 'Maximum git commits to scan (supersession may be incomplete)', parsePositiveInt)
    .option('--since <ref>', 'Only consider commits since ref/date')
    .option('--until <ref>', 'Only consider commits until ref/date');
}
