import type { Command } from 'commander';

// Pure Logic Modules
import { createQueryTarget } from '../../core/logic/query-targets.js';
import type { QueryOptions } from '../../core/types/query.js';
import type { EngineInfra } from '../../services/engine-bootstrapper.js';
import { findAtomsStream } from '../../shell/orchestrators/discovery.js';
import { mergeOptions } from './helpers/merge-options.js';
import { addPathQueryOptions, type PathQueryCommandOptions } from './helpers/path-query.js';

/**
 * Register the log command.
 * Standardizes git-history based surveyor across all protocols.
 */
export function registerLogCommand(
  program: Command,
  infra: EngineInfra,
): void {
  const { protocolRoot, cwd } = infra;
  const cmd = program
    .command('log [paths...]')
    .description('Chronological decision surveyors for specific paths');

  addPathQueryOptions(cmd);

  cmd.action(async (paths: string[] | undefined, _options: PathQueryCommandOptions, command: Command) => {
    const options = mergeOptions<PathQueryCommandOptions>(command);
    const { getFormatter, logger } = infra;

    // Step 1: Resolve target using the pure logic
    const target = createQueryTarget(options.scope ? undefined : paths, { 
        cwd, 
        protocolRoot, 
        isScoped: !!options.scope 
    });

    const formatter = getFormatter();
    
    // 1. Output Header
    logger.result(formatter.formatHeader(target.raw ? target.raw.toString() : 'all', target.type));

    const queryOptions: QueryOptions = {
        ...options,
        includeAllCommits: options.history ?? false
    };

    const stream = findAtomsStream(infra, target, queryOptions);
    
    let totalCount = 0;
    let filteredCount = 0;
    let oldest: Date | null = null;
    let newest: Date | null = null;

    for await (const atom of stream) {
        totalCount++;
        
        // Apply display-level limit
        if (options.limit && filteredCount >= options.limit) continue;

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
