import type { Command } from 'commander';

import { formatCommit } from '../../core/logic/commit-formatting.js';
// Pure Logic Modules
import { createQueryTarget } from '../../core/logic/query-targets.js';
import { squashAtoms } from '../../core/logic/squashing.js';
import type { EngineConfig } from '../../core/types/config.js';
import type { ILogger } from '../../interfaces/logger.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { AtomRepository } from '../../services/atom-repository.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';
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
  deps: {
    atomRepository: AtomRepository;
    protocolRegistry: ProtocolRegistry;
    config: EngineConfig;
    getFormatter: () => IOutputFormatter;
    logger: ILogger;
    protocolRoot: string;
    cwd: string;
  },
): void {
  const { protocolRoot, cwd } = deps;
  program
    .command('squash <range>')
    .description('Merge atoms for squash-merge preparation')
    .option('--subject <text>', 'Override the subject line of the merged message')
    .option('--body <text>', 'Override the body of the merged message')
    .action(async (range: string, options: SquashCommandOptions) => {
      const { atomRepository, protocolRegistry, config, logger } = deps;

      const target = createQueryTarget(range, { cwd, protocolRoot, isScoped: false });
      const atoms = await atomRepository.find(target, { includeAllCommits: true });
      
      // Ensure atoms are sorted by date ascending (Oldest First) for stable subject/body resolution
      atoms.sort((a, b) => a.date.getTime() - b.date.getTime());

      if (atoms.length === 0) {
        throw new ProtocolError('No atoms found in the specified range.', 1);
      }

      const input = squashAtoms(atoms, {
        subject: options.subject,
        body: options.body,
      }, protocolRegistry);

      const { message } = formatCommit(input, config, protocolRegistry);

      // Output to stdout (raw message, not formatted)
      logger.result(message);
    });
}
