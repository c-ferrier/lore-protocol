import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { StalenessDetector } from '../services/staleness-detector.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { Atom } from '../types/domain.js';
import type { PathQueryOptions } from '../types/query.js';
import type { FormattableStalenessResult } from '../types/output.js';
import { STALE_SIGNAL } from '../util/constants.js';
import { mergeOptions } from './helpers/merge-options.js';
import type { ILogger } from '../interfaces/logger.js';

import type { QueryTargetFactory } from '../services/query-target-factory.js';

interface StaleCommandOptions {
  readonly olderThan?: string;
  readonly drift?: number;
  readonly signals?: string[];
}

/**
 * Register the ` stale [target]` command.
 * Flags potentially outdated knowledge using multiple staleness signals.
 * Target is optional -- if omitted, analyzes all atoms globally.
 */
export function registerStaleCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    stalenessDetector: StalenessDetector;
    getFormatter: () => IOutputFormatter;
    logger: ILogger;
    targetFactory: QueryTargetFactory;
  },
): void {
  program
    .command('stale [target]')
    .description('Flag potentially outdated atoms')
    .option('--older-than <duration>', 'Time-based staleness threshold (e.g., 6m, 1y)')
    .option('--drift <n>', 'File drift threshold (commits since atom)', parseInt)
    .action(async (rawTarget: string | undefined, _options: StaleCommandOptions, command: Command) => {
      const options = mergeOptions<StaleCommandOptions & PathQueryOptions>(command);
      const { atomRepository, stalenessDetector, getFormatter, targetFactory } = deps;

      // 1. Resolve target using the opaque factory
      const target = targetFactory.create(rawTarget);
      
      const atoms = await atomRepository.find(target);

      // 2. Filter to active atoms only (stale check on superseded atoms is not useful)
      const activeAtoms = atoms.filter(atom => {
          for (const state of atom.protocols.values()) {
              if (state.supersession?.superseded) return false;
          }
          return true;
      });

      // 3. Run staleness analysis
      let reports = await stalenessDetector.analyze(
        activeAtoms,
        new Map(),
      );

      // 5. Apply additional CLI-level filters: keep reports that match ANY active signal
      const activeSignals: string[] = options.signals || [];
      if (options.olderThan) activeSignals.push(STALE_SIGNAL.AGE);
      if (options.drift !== undefined) activeSignals.push(STALE_SIGNAL.DRIFT);
      if (activeSignals.length > 0) {
        reports = reports.filter(r => r.reasons.some(reason => activeSignals.includes(reason.signal)));
      }

      const stalenessResult: FormattableStalenessResult = {
        atoms: reports,
      };

      const formatter = getFormatter();
      deps.logger.result(formatter.formatStalenessResult(stalenessResult));
    });
}
