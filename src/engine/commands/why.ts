import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { SupersessionStatus } from '../types/domain.js';
import type { QueryResult, QueryMeta } from '../types/query.js';
import type { FormattableQueryResult } from '../types/output.js';
import { ProtocolError } from '../util/errors.js';
import { addPathQueryOptions, type PathQueryCommandOptions } from './helpers/path-query.js';
import { mergeOptions } from './helpers/merge-options.js';
import type { ProtocolRegistry } from '../services/protocol-registry.js';

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
  },
): void {
  const cmd = program
    .command('why <target>')
    .description('Decision context for a specific line or line range');

  addPathQueryOptions(cmd);

  cmd.action(async (target: string, _options: PathQueryCommandOptions, command: Command) => {
    const { atomRepository, getFormatter, protocolRegistry } = deps;
    
    if (protocolRegistry.getAll().length === 0) {
        throw new ProtocolError('At least one protocol must be registered to run this command.', 1);
    }

    const options = mergeOptions<PathQueryCommandOptions>(command);

    // Step 1: Resolve atoms using high-level Repository API
    // This encapsulates PathResolver and Git-blame construction.
    const atoms = await atomRepository.findByLineRange(target, options);

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
      target,
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
          supersededBy: null,
        });
      }
    }

    const formattable: FormattableQueryResult = {
      result,
      supersessionMap,
      visibleTrailers: 'all',
    };

    const formatter = getFormatter();
    console.log(formatter.formatQueryResult(formattable));
  });
}
