// Pure Logic Modules
import { 
    evaluateAgeSignal, 
    evaluateDriftSignal, 
    getStaleSignals
} from '../../core/logic/staleness.js';
import type { EngineConfig } from '../../core/types/config.js';
import type { Atom, StaleReason,SupersessionStatus } from '../../core/types/domain.js';
import type { StaleAtomReport } from '../../core/types/output.js';
import type { IGitClient } from '../../interfaces/git-client.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';

/**
 * Orchestrates the analysis of Atoms to detect "staleness" signals.
 * UI-Agnostic: Suitable for CLI, Web Services, or CI integration.
 * 
 * DESIGN: Coordinates between Core Logic (pure math) and Shell Services (I/O).
 */
export async function analyzeStaleness(
    atoms: readonly Atom[],
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>,
    deps: {
      gitClient: IGitClient;
      config: EngineConfig;
      protocolRegistry: ProtocolRegistry;
    }
  ): Promise<StaleAtomReport[]> {
    const { gitClient, config, protocolRegistry } = deps;
    const now = new Date();
    const protocols = protocolRegistry.getAll();

    const results = await Promise.all(atoms.map(async (atom) => {
      const reasons: StaleReason[] = [];

      // 1. Structural Signals (Generic Engine Level)
      const ageSignal = evaluateAgeSignal(atom.date, now, config.stale.olderThan);
      if (ageSignal) reasons.push(ageSignal);

      const driftMap = await buildDriftMap(atom, gitClient);
      const driftSignal = evaluateDriftSignal(driftMap, config.stale.driftThreshold);
      if (driftSignal) reasons.push(driftSignal);

      // 2. Protocol-Specific Signals
      for (const p of protocols) {
          const pReasons = getStaleSignals(p, atom, now, globalSupersessionMap);
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
  async function buildDriftMap(atom: Atom, gitClient: IGitClient): Promise<Record<string, number>> {
    const driftMap: Record<string, number> = {};
    
    await Promise.all(Array.from(atom.filesChanged).map(async (file) => {
      try {
        const count = await gitClient.countCommitsSince(file, atom.commitHash);
        driftMap[file] = count;
      } catch {
        // Skip files that cannot be blamed (e.g. deleted)
      }
    }));

    return driftMap;
  }
