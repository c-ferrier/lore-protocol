import type { IGitClient } from '../interfaces/git-client.js';
import type { EngineConfig } from '../core/types/config.js';
import type { Atom, SupersessionStatus, StaleReason } from '../core/types/domain.js';
import type { ProtocolRegistry } from './protocol-registry.js';
import type { StaleAtomReport } from '../core/types/output.js';

// Pure Logic Modules
import { 
    evaluateAgeSignal, 
    evaluateDriftSignal, 
    getProtocolStaleSignals
} from '../core/logic/staleness.js';

/**
 * Orchestrator for analyzing Atoms to detect "staleness" signals.
 * Coordinates Git I/O for drift and delegates to pure logic modules.
 */
export class StalenessDetector {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly config: EngineConfig,
    private readonly protocolRegistry: ProtocolRegistry,
  ) {}

  /**
   * Performs analysis on a set of atoms and returns reports for those that are stale.
   */
  async analyze(
    atoms: readonly Atom[],
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>,
  ): Promise<StaleAtomReport[]> {
    const now = new Date();
    const protocols = this.protocolRegistry.getAll();

    const results = await Promise.all(atoms.map(async (atom) => {
      const reasons: StaleReason[] = [];

      // 1. Structural Signals (Generic Engine Level)
      const ageSignal = evaluateAgeSignal(atom.date, now, this.config.stale.olderThan);
      if (ageSignal) reasons.push(ageSignal);

      const driftMap = await this.buildDriftMap(atom);
      const driftSignal = evaluateDriftSignal(driftMap, this.config.stale.driftThreshold);
      if (driftSignal) reasons.push(driftSignal);

      // 2. Protocol-Specific Signals
      for (const p of protocols) {
          const pReasons = getProtocolStaleSignals(p, atom, now, globalSupersessionMap);
          reasons.push(...pReasons);
      }

      if (reasons.length > 0) {
        return { atom, reasons } as StaleAtomReport;
      }
      return null;
    }));

    return results.filter((r): r is StaleAtomReport => r !== null);
  }

  /**
   * Fetches the commit count for all files modified by an atom.
   * This is the I/O portion of the drift calculation.
   */
  private async buildDriftMap(atom: Atom): Promise<Record<string, number>> {
    const driftMap: Record<string, number> = {};
    
    await Promise.all(atom.filesChanged.map(async (file) => {
      try {
        const count = await this.gitClient.countCommitsSince(file, atom.commitHash);
        driftMap[file] = count;
      } catch {
        // Skip files that cannot be blamed (e.g. deleted)
      }
    }));

    return driftMap;
  }
}
