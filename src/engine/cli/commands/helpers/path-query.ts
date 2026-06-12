import { type Command } from 'commander';

// Pure Logic Modules
import { createQueryTarget } from '../../../core/logic/query-targets.js';
import type { Atom } from '../../../core/types/domain.js';
import type { FormattableQueryResult } from '../../../core/types/output.js';
import type { QueryOptions,QueryResult } from '../../../core/types/query.js';
import type { EngineInfra } from '../../../services/engine-bootstrapper.js';
import { findAtomsStream } from '../../../shell/orchestrators/discovery.js';
import { ProtocolError } from '../../../util/errors.js';

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

export type PathQueryDeps = EngineInfra;

export interface PathQueryCommandOptions {
  readonly filter?: string[];
  readonly scope?: string;
  readonly follow?: boolean;
  readonly all?: boolean;
  readonly history?: boolean;
  readonly author?: string;
  readonly limit?: number;
  readonly maxCommits?: number;
  readonly since?: string;
  readonly until?: string;
  readonly text?: string;
  readonly has?: string;
}

/**
 * Shared helper for path-scoped query commands.
 * Unified streaming implementation for log, context, constraints, etc.
 * 
 * GRASP: Pure Fabrication -- handles the standard CLI interaction lifecycle.
 */
export async function executePathQuery(
  rawTarget: string | string[] | undefined,
  options: PathQueryCommandOptions,
  infra: PathQueryDeps,
  _commandName: string,
  visibleTrailers: readonly string[] | 'all',
): Promise<void> {
  const { config, logger, getFormatter, protocolRoot, cwd } = infra;

  const queryOptions: QueryOptions = {
    filters: options.filter || [],
    scope: options.scope ?? null,
    follow: options.follow ?? false,
    maxDepth: config.follow.maxDepth,
    all: options.all ?? false,
    includeAllCommits: options.history ?? false,
    author: options.author ?? null,
    limit: options.limit ?? null,
    maxCommits: options.maxCommits ?? null,
    since: options.since ?? null,
    until: options.until ?? null,
    text: options.text ?? null,
    has: options.has ?? null,
  };

  // Step 1: Resolve target using pure logic
  const target = createQueryTarget(queryOptions.scope ? undefined : rawTarget, { 
    cwd, 
    protocolRoot, 
    isScoped: !!queryOptions.scope 
  });

  const formatter = getFormatter();
  
  // 1. Output Header
  const header = formatter.formatHeader(target.raw ? target.raw.toString() : 'all', target.type, visibleTrailers);
  if (header) logger.result(header);

  const stream = findAtomsStream(infra, target, queryOptions);
  
  let totalCount = 0;
  let filteredCount = 0;
  let oldest: Date | null = null;
  let newest: Date | null = null;

  for await (const atom of stream) {
      totalCount++;

      // 1. Supersession filter (Active Truth)
      if (!queryOptions.all) {
          let isSuperseded = false;
          for (const state of atom.protocols.values()) {
              if (state.supersession?.superseded) { isSuperseded = true; break; }
          }
          if (isSuperseded) continue;
      }
      
      // 2. Result Limit check (after logical filtering)
      if (queryOptions.limit && filteredCount >= queryOptions.limit) continue;

      filteredCount++;
      
      // 3. Stats tracking
      if (!oldest || atom.date < oldest) oldest = atom.date;
      if (!newest || atom.date > newest) newest = atom.date;

      // 4. Output Atom Progressive
      const atomOutput = formatter.formatAtom(atom, visibleTrailers);
      if (atomOutput) logger.result(atomOutput);
  }

  // 3. Output Footer
  const footer = formatter.formatFooter({ 
      total: totalCount, 
      filtered: filteredCount,
      oldest,
      newest
  });
  if (footer) logger.result(footer);
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
    .option('--history', 'Show full physical history including non-protocol commits')
    .option('--author <email>', 'Filter by commit author')
    .option('--text <query>', 'Search commit subjects and bodies')
    .option('--has <key>', 'Search for atoms containing a specific trailer key')
    .option('--limit <n>', 'Maximum number of results to display', parsePositiveInt)
    .option('--max-commits <n>', 'Maximum git commits to scan (supersession may be incomplete)', parsePositiveInt)
    .option('--since <ref>', 'Only consider commits since ref/date')
    .option('--until <ref>', 'Only consider commits until ref/date');
}
