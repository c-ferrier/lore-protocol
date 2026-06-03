import type { Command } from 'commander';
import type { AtomRepository } from '../../services/atom-repository.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { EngineConfig } from '../../types/config.js';
import type { Atom, SupersessionStatus } from '../../types/domain.js';
import type { PathQueryOptions, QueryResult } from '../../types/query.js';
import type { FormattableQueryResult } from '../../types/output.js';
import { buildQueryMeta } from './build-query-meta.js';
import type { ILogger } from '../../interfaces/logger.js';
import { ProtocolError } from '../../util/errors.js';

// Pure Logic Modules
import { createQueryTarget } from '../../logic/query-targets.js';

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
  readonly getFormatter: () => IOutputFormatter;
  readonly config: EngineConfig;
  readonly logger: ILogger;
  readonly protocolRoot: string;
  readonly gitRoot: string;
  readonly cwd: string;
}

export interface PathQueryCommandOptions {
  readonly filter?: string[];
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
  rawTarget: string,
  options: PathQueryCommandOptions,
  deps: PathQueryDeps,
  commandName: string,
  visibleTrailers: readonly string[] | 'all',
): Promise<void> {
  const { atomRepository, getFormatter, config, logger, protocolRoot, gitRoot, cwd } = deps;

  const queryOptions = {
    filters: options.filter && options.filter.length > 0 ? options.filter : undefined,
    scope: options.scope ?? null,
    follow: options.follow ?? false,
    maxDepth: config.follow.maxDepth,
    all: options.all ?? false,
    author: options.author ?? null,
    limit: options.limit ?? null,
    maxCommits: options.maxCommits ?? null,
    since: options.since ?? null,
    until: options.until ?? null,
  };

  // Step 1: Resolve target using pure logic
  const target = createQueryTarget(queryOptions.scope ? undefined : rawTarget, { 
    cwd, 
    protocolRoot, 
    isScoped: !!queryOptions.scope 
  });

  const atoms = await atomRepository.find(target, { ...queryOptions, limit: null });

  const totalAtoms = atoms.length;

  // Step 3: Filter superseded atoms unless --all (Active Truth)
  // We use the internalized status for high-speed filtering.
  let displayAtoms: readonly Atom[];
  if (queryOptions.all) {
    displayAtoms = atoms;
  } else {
    displayAtoms = atoms.filter(atom => {
        // Find ANY protocol interpretation that is superseded
        for (const state of atom.protocols.values()) {
            if (state.supersession?.superseded) return false;
        }
        return true;
    });
  }

  // Step 4b: Apply result limit (--limit) after supersession filtering
  if (queryOptions.limit !== null && queryOptions.limit !== undefined && queryOptions.limit > 0) {
    displayAtoms = displayAtoms.slice(0, queryOptions.limit);
  }

  // Step 5: Build QueryResult
  const result: QueryResult = {
    command: commandName,
    target: target.raw.toString(),
    targetType: target.type === 'line-range' ? 'line-range' : 'path',
    atoms: displayAtoms,
    meta: buildQueryMeta(totalAtoms, displayAtoms),
  };

  const formattable: FormattableQueryResult = {
    result,
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
    .option('--filter <query>', 'Filter by specific trailer logic (e.g. "Status=active" or "project/Priority:eq=high")', (val, memo: string[]) => {
      memo.push(val);
      return memo;
    }, [])
    .option('--scope <name>', 'Filter by conventional commit scope instead of path')
    .option('--follow', 'Transitively follow Related/Supersedes/Depends-on links')
    .option('--all', 'Include superseded entries')
    .option('--author <email>', 'Filter by commit author')
    .option('--limit <n>', 'Maximum number of results to display', parsePositiveInt)
    .option('--max-commits <n>', 'Maximum git commits to scan (supersession may be incomplete)', parsePositiveInt)
    .option('--since <ref>', 'Only consider commits since ref/date')
    .option('--until <ref>', 'Only consider commits until ref/date');
}
