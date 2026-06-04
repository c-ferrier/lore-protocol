import type { Command } from 'commander';
import type { AtomRepository } from '../../services/atom-repository.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { SupersessionStatus } from '../../core/types/domain.js';
import type { QueryResult, QueryMeta } from '../../core/types/query.js';
import type { FormattableQueryResult } from '../../core/types/output.js';
import { ProtocolError } from '../../util/errors.js';
import { addPathQueryOptions, type PathQueryCommandOptions } from './helpers/path-query.js';
import { mergeOptions } from './helpers/merge-options.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';

// Pure Logic Modules
import { createQueryTarget } from '../../core/logic/query-targets.js';

/**
 * Register the `why <target>` command.
 * Target must be `file:line` or `file:line-line` format.
 */
export function registerWhyCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    getFormatter: () => IOutputFormatter;
    protocolRegistry: ProtocolRegistry;
    protocolRoot: string;
    gitRoot: string;
    cwd: string;
  },
): void {
  const { protocolRoot, gitRoot, cwd } = deps;
  const cmd = program
    .command('why <target>')
    .description('Decision context for a specific line or line range');

  addPathQueryOptions(cmd);

  cmd.action(async (rawTarget: string, _options: PathQueryCommandOptions, command: Command) => {
    const { atomRepository, getFormatter, protocolRegistry } = deps;
    
    if (protocolRegistry.getAll().length === 0) {
        throw new ProtocolError('At least one protocol must be registered to run this command.', 1);
    }

    const options = mergeOptions<PathQueryCommandOptions>(command);

    // Step 1: Resolve target using the pure logic
    const target = createQueryTarget(rawTarget, { cwd, protocolRoot, isScoped: false });

    // Step 2: Resolve atoms using high-level Repository API
    const atoms = await atomRepository.find(target, options);

    const totalAtoms = atoms.length;
    
    // Build result metadata
    const meta: QueryMeta = {
      totalAtoms,
      filteredAtoms: atoms.length,
      oldest: totalAtoms > 0
        ? new Date(Math.min(...atoms.map((a: any) => a.date.getTime())))
        : null,
      newest: totalAtoms > 0
        ? new Date(Math.max(...atoms.map((a: any) => a.date.getTime())))
        : null,
    };

    const result: QueryResult = {
      command: 'why',
      target: target.raw.toString(),
      targetType: 'line-range',
      atoms,
      meta,
    };

    // Build a minimal supersession map (no supersession filtering for why)
    const supersessionMap = new Map<string, SupersessionStatus>();
    for (const atom of atoms) {
      const id = protocolRegistry.getIdentity(atom);
      if (id) {
        supersessionMap.set(id, {
          superseded: false,
          supersededBy: [],
        });
      }
    }

    const formattable: FormattableQueryResult = {
      result,
      visibleTrailers: 'all',
    };

    const formatter = getFormatter();
    console.log(formatter.formatQueryResult(formattable));
  });
}
