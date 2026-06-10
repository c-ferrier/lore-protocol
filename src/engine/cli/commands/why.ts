import type { Command } from 'commander';

// Pure Logic Modules
import { createQueryTarget } from '../../core/logic/query-targets.js';
import type { FormattableQueryResult } from '../../core/types/output.js';
import type { QueryMeta,QueryResult } from '../../core/types/query.js';
import type { EngineInfra } from '../../services/engine-bootstrapper.js';
import { findAtoms } from '../../shell/orchestrators/discovery.js';
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

    // Step 2: Resolve atoms using orchestrator
    const atoms = await findAtoms(infra, target, options);

    const totalAtoms = atoms.length;
    
    // Build result metadata
    const meta: QueryMeta = {
      totalAtoms,
      filteredAtoms: atoms.length,
      oldest: totalAtoms > 0
        ? new Date(Math.min(...atoms.map((a) => a.date.getTime())))
        : null,
      newest: totalAtoms > 0
        ? new Date(Math.max(...atoms.map((a) => a.date.getTime())))
        : null,
    };

    const result: QueryResult = {
      command: 'why',
      target: target.raw.toString(),
      targetType: 'line-range',
      atoms,
      meta,
    };

    const formattable: FormattableQueryResult = {
      result,
      visibleTrailers: 'all',
    };

    const formatter = getFormatter();
    logger.result(formatter.formatQueryResult(formattable));
  });
}
