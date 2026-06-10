// Pure Logic Modules
import { 
    evaluateAgeSignal, 
    evaluateDriftSignal, 
    getStaleSignals
} from '../../core/logic/staleness.js';
import type { EngineConfig } from '../../core/types/config.js';
import type { Atom, StaleReason,SupersessionStatus } from '../../core/types/domain.js';
import type { StaleAtomReport } from '../../core/types/output.js';
import type { AtomRepository } from '../../services/atom-repository.js';
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
      atomRepository: AtomRepository;
      config: EngineConfig;
      protocolRegistry: ProtocolRegistry;
    }
  ): Promise<StaleAtomReport[]> {
    const { atomRepository, config, protocolRegistry } = deps;
    const now = new Date();
    const protocols = protocolRegistry.getAll();

    const results = await Promise.all(atoms.map(async (atom) => {
      const reasons: StaleReason[] = [];

      // 1. Structural Signals (Generic Engine Level)
      const ageSignal = evaluateAgeSignal(atom.date, now, config.stale.olderThan);
      if (ageSignal) reasons.push(ageSignal);

      try {
        const driftMap = await atomRepository.getAtomDrift(atom);
        const driftSignals = evaluateDriftSignal(driftMap, config.stale.driftThreshold);
        reasons.push(...driftSignals);
      } catch (_err) {
        // Log or skip drift on error (best effort)
      }

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
