import type { IGitClient } from '../interfaces/git-client.js';
import type { Config } from '../types/config.js';
import type { Atom, SupersessionStatus, StaleReason } from '../types/domain.js';
import { STALE_SIGNAL } from '../../util/constants.js';
import type { ProtocolRegistry } from './protocol-registry.js';

export interface StaleAtomReport {
  readonly atom: Atom;
  readonly reasons: readonly StaleReason[];
}

/**
 * Analyzes Atoms to detect "staleness" signals.
 * Supports multiple protocols via the ProtocolRegistry.
 * 
 * SOLID: SRP -- only responsible for staleness analysis.
 * GRASP: Information Expert -- knows how to interpret time and drift.
 * Protocols handle their own domain-specific staleness rules.
 */
export class StalenessDetector {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly config: Config,
    private readonly protocolRegistry: ProtocolRegistry,
  ) {}

  /**
   * Performs analysis on a set of atoms and returns reports for those that are stale.
   */
  async analyze(
    atoms: readonly Atom[],
    supersessionMap: Map<string, SupersessionStatus>,
  ): Promise<StaleAtomReport[]> {
    const reports: StaleAtomReport[] = [];
    const now = new Date();
    const protocols = this.protocolRegistry.getAll();

    for (const atom of atoms) {
      const reasons: StaleReason[] = [];

      // 1. Structural Signals (Generic Engine Level)
      this.checkAge(atom, now, reasons);
      await this.checkDrift(atom, reasons);

      // 2. Protocol-Specific Signals
      for (const protocol of protocols) {
          const pReasons = protocol.getStaleSignals(atom, now, supersessionMap);
          reasons.push(...pReasons);
      }

      if (reasons.length > 0) {
        reports.push({ atom, reasons });
      }
    }

    return reports;
  }

  /**
   * Check if an atom's absolute age exceeds the threshold.
   */
  private checkAge(atom: Atom, now: Date, reasons: StaleReason[]): void {
    const thresholdMs = this.parseDuration(this.config.stale.olderThan);
    if (thresholdMs === null) return;

    if (now.getTime() - atom.date.getTime() > thresholdMs) {
      reasons.push({
        signal: STALE_SIGNAL.AGE,
        description: `Atom is older than ${this.config.stale.olderThan} (${this.formatAge(now.getTime() - atom.date.getTime())})`,
      });
    }
  }

  /**
   * Check if the files associated with the atom have changed significantly.
   */
  private async checkDrift(atom: Atom, reasons: StaleReason[]): Promise<void> {
    const threshold = this.config.stale.driftThreshold;
    const driftedFiles: string[] = [];

    for (const file of atom.filesChanged) {
      try {
        const count = await this.gitClient.countCommitsSince(file, atom.commitHash);
        if (count > threshold) {
          driftedFiles.push(file);
        }
      } catch {
        // Skip files that cannot be blamed (e.g. deleted)
      }
    }

    if (driftedFiles.length > 0) {
      reasons.push({
        signal: STALE_SIGNAL.DRIFT,
        description: `Source files have drifted (${driftedFiles.length} files with >${threshold} commits)`,
      });
    }
  }

  /**
   * Parse a duration string (e.g. '6m', '1y') into milliseconds.
   */
  private parseDuration(duration: string): number | null {
    const match = duration.match(/^(\d+)([dwmy])$/);
    if (!match) return null;

    const value = parseInt(match[1], 10);
    const unit = match[2];
    const msPerDay = 24 * 60 * 60 * 1000;

    switch (unit) {
      case 'd':
        return value * msPerDay;
      case 'w':
        return value * 7 * msPerDay;
      case 'm':
        return value * 30 * msPerDay;
      case 'y':
        return value * 365 * msPerDay;
      default:
        return 6 * 30 * msPerDay;
    }
  }

  /**
   * Format an age in milliseconds to a human-readable string.
   */
  private formatAge(ageMs: number): string {
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    if (days >= 365) {
      const years = Math.floor(days / 365);
      return `${years} year${years === 1 ? '' : 's'}`;
    }
    if (days >= 30) {
      const months = Math.floor(days / 30);
      return `${months} month${months === 1 ? '' : 's'}`;
    }
    if (days >= 7) {
      const weeks = Math.floor(days / 7);
      return `${weeks} week${weeks === 1 ? '' : 's'}`;
    }
    return `${days} day${days === 1 ? '' : 's'}`;
  }
}
