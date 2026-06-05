import type { Command } from 'commander';

// Pure Logic Modules
import { createQueryTarget } from '../../core/logic/query-targets.js';
import type { EngineConfig } from '../../core/types/config.js';
import type { FormattableStalenessResult } from '../../core/types/output.js';
import type { PathQueryOptions } from '../../core/types/query.js';
import type { IGitClient } from '../../interfaces/git-client.js';
import type { ILogger } from '../../interfaces/logger.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { AtomRepository } from '../../services/atom-repository.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';
import { analyzeStaleness } from '../../shell/orchestrators/staleness.js';
import { STALE_SIGNAL } from '../../util/constants.js';
import { mergeOptions } from './helpers/merge-options.js';

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
    protocolRegistry: ProtocolRegistry;
    gitClient: IGitClient;
    config: EngineConfig;
    getFormatter: () => IOutputFormatter;
    logger: ILogger;
    protocolRoot: string;
    cwd: string;
  },
): void {
  const { protocolRoot, cwd } = deps;
  program
    .command('stale [target]')
    .description('Flag potentially outdated atoms')
    .option('--older-than <duration>', 'Time-based staleness threshold (e.g., 6m, 1y)')
    .option('--drift <n>', 'File drift threshold (commits since atom)', parseInt)
    .action(async (rawTarget: string | undefined, _options: StaleCommandOptions, command: Command) => {
      const options = mergeOptions<StaleCommandOptions & PathQueryOptions>(command);
      const { atomRepository, protocolRegistry, gitClient, config, getFormatter } = deps;

      // 1. Resolve target using the pure logic
      const target = createQueryTarget(rawTarget, { cwd, protocolRoot, isScoped: false });
      
      const atoms = await atomRepository.find(target);

      // 2. Filter to active atoms only (stale check on superseded atoms is not useful)
      const activeAtoms = atoms.filter(atom => {
          for (const state of atom.protocols.values()) {
              if (state.supersession?.superseded) return false;
          }
          return true;
      });

      // 3. Run staleness analysis
      let reports = await analyzeStaleness(
        activeAtoms,
        new Map(),
        {
            gitClient,
            config,
            protocolRegistry
        }
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
