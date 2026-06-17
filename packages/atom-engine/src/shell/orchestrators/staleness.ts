// Pure Logic Modules
import { 
    evaluateAgeSignal, 
    evaluateDriftSignal, 
    getStaleSignals
} from '../../core/logic/staleness.js';
import { ProtocolMap } from '../../core/models/protocol-map.js';
import type { EngineConfig } from '../../core/types/config.js';
import type { Atom, StaleReason,SupersessionStatus } from '../../core/types/domain.js';
import type { StaleAtomReport } from '../../core/types/output.js';
import type { ProtocolContext } from '../../core/types/protocol-definition.js';
import type { IGitClient } from '../../interfaces/git-client.js';
import { calculateDriftBatch } from './discovery.js';

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
      protocols: ProtocolMap<ProtocolContext>;
    }
  ): Promise<StaleAtomReport[]> {
    const { gitClient, config, protocols } = deps;
    const now = new Date();
    const protocolList = Array.from(protocols.values());

    // 1. Pre-calculate Drift for the entire batch in ONE Git pass
    let driftResults = new Map<string, Record<string, number>>();
    try {
      driftResults = await calculateDriftBatch({ git: gitClient }, atoms);
    } catch (_err) {
      // Best effort: if batch drift fails, continue without drift signals
    }

    const results = atoms.map((atom) => {
      const reasons: StaleReason[] = [];

      // 1. Structural Signals (Generic Engine Level)
      const ageSignal = evaluateAgeSignal(atom.date, now, config.stale.olderThan);
      if (ageSignal) reasons.push(ageSignal);

      const driftMap = driftResults.get(atom.commitHash) || {};
      const driftSignals = evaluateDriftSignal(driftMap, config.stale.driftThreshold);
      reasons.push(...driftSignals);

      // 2. Protocol-Specific Signals
      for (const p of protocolList) {
          const pReasons = getStaleSignals(p, atom, now, globalSupersessionMap);
          reasons.push(...pReasons);
      }

      if (reasons.length > 0) {
        return { atom, reasons };
      }
      return null;
    });

    return results.filter((r): r is { atom: Atom; reasons: StaleReason[] } => r !== null);
  }
