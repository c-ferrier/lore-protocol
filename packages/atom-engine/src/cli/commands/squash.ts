import type { Command } from 'commander';

import { formatCommit } from '../../core/logic/commit-formatting.js';
// Pure Logic Modules
import { createQueryTarget } from '../../core/logic/query-targets.js';
import { squashAtoms } from '../../core/logic/squashing.js';
import type { EngineInfra } from '../../services/engine-bootstrapper.js';
import { findAtoms } from '../../shell/orchestrators/discovery.js';
import { ProtocolError } from '../../util/errors.js';

interface SquashCommandOptions {
  readonly subject?: string;
  readonly body?: string;
}

/**
 * Register the `squash <range>` command.
 * Takes a git revision range, gets all atoms in that range,
 * merges them via squashAtoms, and outputs the merged message to stdout.
 */
export function registerSquashCommand(
  program: Command,
  infra: EngineInfra,
): void {
  const { protocolRoot, cwd } = infra;
  program
    .command('squash <range>')
    .description('Merge atoms for squash-merge preparation')
    .option('--subject <text>', 'Override the subject line of the merged message')
    .option('--body <text>', 'Override the body of the merged message')
    .action(async (range: string, options: SquashCommandOptions) => {
      const { config, logger, protocols: protocolMap } = infra;

      const target = createQueryTarget(range, { cwd, protocolRoot, isScoped: false });
      const atoms = await findAtoms(infra, target, { includeAllCommits: true });
      
      // Ensure atoms are sorted by date ascending (Oldest First) for stable subject/body resolution
      atoms.sort((a, b) => a.date.getTime() - b.date.getTime());

      if (atoms.length === 0) {
        throw new ProtocolError('No atoms found in the specified range.', 1);
      }

      const input = squashAtoms(atoms, {
        subject: options.subject,
        body: options.body,
      }, protocolMap);

      const { message } = formatCommit(input, config, protocolMap);

      // Output to stdout (raw message, not formatted)
      logger.result(message);
    });
}
