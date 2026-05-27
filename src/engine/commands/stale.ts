import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { SupersessionResolver } from '../services/supersession-resolver.js';
import type { StalenessDetector } from '../services/staleness-detector.js';
import type { PathResolver } from '../services/path-resolver.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { Atom, SupersessionStatus } from '../types/domain.js';
import type { PathQueryOptions } from '../types/query.js';
import type { FormattableStalenessResult, StaleAtomReport } from '../types/output.js';
import { STALE_SIGNAL } from '../../util/constants.js';
import { mergeOptions } from './helpers/merge-options.js';
import type { ILogger } from '../interfaces/logger.js';

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
    supersessionResolver: SupersessionResolver;
    stalenessDetector: StalenessDetector;
    pathResolver: PathResolver;
    getFormatter: () => IOutputFormatter;
    logger: ILogger;
  },
): void {
  program
    .command('stale [target]')
    .description('Flag potentially outdated atoms')
    .option('--older-than <duration>', 'Time-based staleness threshold (e.g., 6m, 1y)')
    .option('--drift <n>', 'File drift threshold (commits since atom)', parseInt)
    .action(async (target: string | undefined, _options: StaleCommandOptions, command: Command) => {
      const options = mergeOptions<StaleCommandOptions>(command);
      const { atomRepository, supersessionResolver, stalenessDetector, pathResolver, getFormatter } = deps;

      let atoms: Atom[];

      if (target) {
        const parsedTarget = pathResolver.parseTarget(target);
        const gitLogArgs = pathResolver.toGitLogArgs(parsedTarget);
        const queryOptions: PathQueryOptions = {
          scope: null,
          follow: false,
          all: false,
          author: null,
          limit: null,
          maxCommits: null,
          since: null,
          until: null,
        };
        atoms = await atomRepository.findByTarget(gitLogArgs, queryOptions);
      } else {
        atoms = await atomRepository.findAll();
      }

      // Compute supersession for dependency-orphan detection
      const globalSupersessionMap = supersessionResolver.resolveAll(atoms);

      // Flatten global map into a single map for the detector (greedy dependency orphan check)
      const flatSupersessionMap = new Map<string, SupersessionStatus>();
      for (const statusMap of globalSupersessionMap.values()) {
          for (const [id, status] of statusMap) {
              flatSupersessionMap.set(id, status);
          }
      }

      // Filter to active atoms only (stale check on superseded atoms is not useful)
      const activeAtoms = supersessionResolver.filterActive(atoms, globalSupersessionMap);

      // Run staleness analysis
      let reports = await stalenessDetector.analyze(
        activeAtoms,
        flatSupersessionMap,
      );

      // Apply additional CLI-level filters: keep reports that match ANY active signal
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
