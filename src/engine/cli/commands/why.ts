import type { Command } from 'commander';

// Pure Logic Modules
import { createQueryTarget } from '../../core/logic/query-targets.js';
import type { EngineInfra } from '../../services/engine-bootstrapper.js';
import { findAtomsStream } from '../../shell/orchestrators/discovery.js';
import { ProtocolError } from '../../util/errors.js';
import { mergeOptions } from './helpers/merge-options.js';
import { addPathQueryOptions, type PathQueryCommandOptions } from './helpers/path-query.js';

/**
 * Register the `why <target>` command.
 * Target must be `file:line` or `file:line-line` format.
 */
export function registerWhyCommand(
  program: Command,
  infra: EngineInfra,
): void {
  const { protocolRoot, cwd } = infra;
  const cmd = program
    .command('why <target>')
    .description('Decision context for a specific line or line range');

  addPathQueryOptions(cmd);

  cmd.action(async (rawTarget: string, _options: PathQueryCommandOptions, command: Command) => {
    const { getFormatter, protocols: protocolMap, logger } = infra;
    
    if (protocolMap.size === 0) {
        throw new ProtocolError('At least one protocol must be registered to run this command.', 1);
    }

    const options = mergeOptions<PathQueryCommandOptions>(command);

    // Step 1: Resolve target using the pure logic
    const target = createQueryTarget(rawTarget, { cwd, protocolRoot, isScoped: false });

    const formatter = getFormatter();
    
    // 1. Output Header
    logger.result(formatter.formatHeader(target.raw.toString(), target.type));

    // Step 2: Resolve atoms using orchestrator
    const stream = findAtomsStream(infra, target, options);

    let totalCount = 0;
    let filteredCount = 0;
    let oldest: Date | null = null;
    let newest: Date | null = null;

    for await (const atom of stream) {
        totalCount++;
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
