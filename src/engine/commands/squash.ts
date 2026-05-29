import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { SquashMerger } from '../services/squash-merger.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import { ProtocolError } from '../util/errors.js';
import type { ILogger } from '../interfaces/logger.js';

interface SquashCommandOptions {
  readonly subject?: string;
  readonly body?: string;
}

/**
 * Register the `squash <range>` command.
 * Takes a git revision range, gets all atoms in that range,
 * merges them via SquashMerger, and outputs the merged message to stdout.
 */
export function registerSquashCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    squashMerger: SquashMerger;
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
      const { atomRepository, squashMerger, logger } = deps;

      const atoms = await atomRepository.findByRange(range);

      if (atoms.length === 0) {
        throw new ProtocolError('No atoms found in the specified range.', 1);
      }

      const { message } = squashMerger.merge(atoms, {
        subject: options.subject,
        body: options.body,
      });

      // Output to stdout (raw message, not formatted)
      logger.result(message);
    });
}
