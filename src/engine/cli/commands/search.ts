import type { Command } from 'commander';

// Pure Logic Modules
import { createQueryTarget } from '../../core/logic/query-targets.js';
import type { QueryOptions } from '../../core/types/query.js';
import type { EngineInfra } from '../../services/engine-bootstrapper.js';
import { findAtomsStream } from '../../shell/orchestrators/discovery.js';
import { mergeOptions } from './helpers/merge-options.js';
import { addPathQueryOptions, type PathQueryCommandOptions } from './helpers/path-query.js';

/**
 * Register the `search` command.
 */
export function registerSearchCommand(
  program: Command,
  infra: EngineInfra,
): void {
  const { protocolRoot, cwd } = infra;
  const cmd = program
    .command('search')
    .description('Search for decision atoms across history');

  addPathQueryOptions(cmd);

  cmd.action(async (_options: PathQueryCommandOptions, command: Command) => {
    const { getFormatter, logger } = infra;

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

const formatter = getFormatter();

// 1. Output Header
logger.result(formatter.formatHeader(target.raw.toString(), target.type));

const stream = findAtomsStream(infra, target, { ...searchOptions, includeAllCommits: !!options.history });

let totalCount = 0;
let filteredCount = 0;
let oldest: Date | null = null;
let newest: Date | null = null;

for await (const atom of stream) {
    totalCount++;

    // Apply supersession filtering unless --all (Active Truth)
    let isSuperseded = false;
    if (!searchOptions.all) {
        for (const state of atom.protocols.values()) {
            if (state.supersession?.superseded) {
                isSuperseded = true;
                break;
            }
        }
    }
    if (isSuperseded) continue;

    // Apply display-level limit
    if (searchOptions.limit && filteredCount >= searchOptions.limit) continue;

    filteredCount++;

    // Update stats
    if (!oldest || atom.date < oldest) oldest = atom.date;
    if (!newest || atom.date > newest) newest = atom.date;

    // 2. Output Atom Progressive
    logger.result(formatter.formatAtom(atom));
}

// 3. Output Footer
logger.result(formatter.formatFooter({ 
    total: totalCount, 
    filtered: filteredCount,
    oldest,
    newest
}));
});
}

