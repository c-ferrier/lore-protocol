import type { Command } from 'commander';
import type { AtomRepository } from '../../services/atom-repository.js';
import type { SupersessionResolver } from '../../services/supersession-resolver.js';
import type { PathResolver } from '../../services/path-resolver.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { LoreConfig } from '../../types/config.js';
import type { TrailerKey, LoreAtom, SupersessionStatus } from '../../types/domain.js';
import type { QueryOptions, QueryResult, TargetType } from '../../types/query.js';
import type { FormattableQueryResult } from '../../types/output.js';
import { buildQueryMeta } from './build-query-meta.js';

/** Parse a CLI value as a strict positive integer; rejects non-numeric trailing chars. */
export function parsePositiveInt(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Expected a positive integer, got "${value}"`);
  }
  const n = Number(value);
  if (n < 1) {
    throw new Error(`Expected a positive integer, got "${value}"`);
  }
  return n;
}

export interface PathQueryDeps {
  readonly atomRepository: AtomRepository;
  readonly supersessionResolver: SupersessionResolver;
  readonly pathResolver: PathResolver;
  readonly getFormatter: () => IOutputFormatter;
  readonly config: LoreConfig;
}

export interface PathQueryCommandOptions {
  readonly scope?: string;
  readonly follow?: boolean;
  readonly all?: boolean;
  readonly author?: string;
  readonly limit?: number;
  readonly page?: number;
  readonly maxCommits?: number;
  readonly since?: string;
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
  visibleTrailers: readonly TrailerKey[] | 'all',
): Promise<void> {
  const { atomRepository, supersessionResolver, pathResolver, getFormatter, config } = deps;

  const queryOptions: QueryOptions = {
    scope: options.scope ?? null,
    text: null,
    confidence: null,
    scopeRisk: null,
    reversibility: null,
    has: null,
    follow: options.follow ?? false,
    followDepth: options.follow ? config.follow.maxDepth : null,
    all: options.all ?? false,
    author: options.author ?? null,
    limit: options.limit ?? null,
    page: options.page ?? null,
    maxCommits: options.maxCommits ?? null,
    since: options.since ?? null,
    until: null,
  };

  // Step 1: Resolve target and perform Discovery
  // The repository handles the full discovery pipeline: Git log (Coarse),
  // narrowing filters (Fine), link resolution (Follow), and supersession.
  let atoms: readonly LoreAtom[];
  let totalAtoms: number;
  let targetType: TargetType | 'search' | 'global';
  let targetDisplay: string;
  let oldest: Date | null;
  let newest: Date | null;

  if (queryOptions.scope) {
    const result = await atomRepository.findByScope(queryOptions.scope, queryOptions);
    atoms = result.atoms;
    totalAtoms = result.totalCount;
    oldest = result.oldest;
    newest = result.newest;
    targetType = 'global';
    targetDisplay = `scope:${queryOptions.scope}`;
  } else {
    const parsedTarget = pathResolver.parseTarget(target);
    const gitLogArgs = pathResolver.toGitLogArgs(parsedTarget);
    const result = await atomRepository.findByTarget(gitLogArgs, queryOptions);
    atoms = result.atoms;
    totalAtoms = result.totalCount;
    oldest = result.oldest;
    newest = result.newest;
    targetType = parsedTarget.type;
    targetDisplay = target;
  }

  // Step 2: Compute supersession status for the result set
  // The map is only needed if --all is set, to identify which atoms to 'dim' in the UI.
  // If --all is false, the repository has already removed all superseded atoms.
  const supersessionMap = queryOptions.all
    ? supersessionResolver.resolve(atoms)
    : new Map<string, SupersessionStatus>();

  // Step 3: Build QueryResult
  const result: QueryResult = {
    command: commandName,
    target: targetDisplay,
    targetType,
    atoms,
    meta: buildQueryMeta(totalAtoms, atoms, { oldest, newest }),
    page: queryOptions.page ?? 1,
    limit: queryOptions.limit ?? atoms.length,
  };

  const formattable: FormattableQueryResult = {
    result,
    supersessionMap,
    visibleTrailers,
  };

  // Step 4: Format and output
  const formatter = getFormatter();
  console.log(formatter.formatQueryResult(formattable));
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
    .option('--page <n>', 'Page number for pagination', parsePositiveInt)
    .option('--max-commits <n>', 'Maximum git commits to scan (supersession may be incomplete)', parsePositiveInt)
    .option('--since <ref>', 'Only consider commits since ref/date');
}
