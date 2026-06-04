import type { Command } from 'commander';
import type { AtomRepository } from '../../services/atom-repository.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import { ProtocolError } from '../../util/errors.js';
import type { ILogger } from '../../interfaces/logger.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';
import type { EngineConfig } from '../../core/types/config.js';

// Pure Logic Modules
import { squashAtoms } from '../../core/logic/squashing.js';
import { formatCommit } from '../../core/logic/commit-formatting.js';

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
  },
): void {
  program
    .command('squash <range>')
    .description('Merge atoms for squash-merge preparation')
    .option('--subject <text>', 'Override the subject line of the merged message')
    .option('--body <text>', 'Override the body of the merged message')
    .action(async (range: string, options: SquashCommandOptions) => {
      const { atomRepository, protocolRegistry, config, logger } = deps;

      const atoms = await atomRepository.findByRange(range);

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
