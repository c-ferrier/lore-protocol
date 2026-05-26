import type { IGitClient } from '../interfaces/git-client.js';
import type { Config } from '../types/config.js';
import type { Atom, SupersessionStatus } from '../types/domain.js';
import { STALE_SIGNAL } from '../../util/constants.js';
import type { StaleSignal } from '../types/domain.js';
import type { ProtocolRegistry } from './protocol-registry.js';

export interface StaleReason {
  readonly signal: StaleSignal;
  readonly description: string;
}

export interface StaleAtomReport {
  readonly atom: Atom;
  readonly reasons: readonly StaleReason[];
}

/**
 * Analyzes Atoms to detect "staleness" signals.
 * Supports multiple protocols via the ProtocolRegistry.
 * 
 * SOLID: SRP -- only responsible for staleness analysis.
 * GRASP: Information Expert -- knows how to interpret time, drift, and directives.
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

      // 1. Structural Signals (Generic)
      this.checkAge(atom, now, reasons);
      await this.checkDrift(atom, reasons);

      // 2. Multi-Protocol Signals
      for (const protocol of protocols) {
          this.checkProtocolStaleness(protocol, atom, now, reasons, supersessionMap);
      }

      if (reasons.length > 0) {
        reports.push({ atom, reasons });
      }
    }

    return reports;
  }

  private checkProtocolStaleness(
      protocol: any,
      atom: Atom,
      now: Date,
      reasons: StaleReason[],
      supersessionMap: Map<string, SupersessionStatus>
  ): void {
      const state = atom.protocols.get(protocol.name.toLowerCase());
      if (!state) return;

      // 1. Low Confidence Signal
      const confidence = state.trailers.Confidence?.[0];
      if (confidence === 'low') {
        reasons.push({
          signal: STALE_SIGNAL.LOW_CONFIDENCE,
          description: `[${protocol.name}] Atom is marked as Confidence: low`,
        });
      }

      // 2. Expired Hints Signal
      const untilPattern = /\[until:([^\]]+)\]/g;
      for (const directive of state.trailers.Directive || []) {
        untilPattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = untilPattern.exec(directive)) !== null) {
          const dateStr = match[1];
          const expiryDate = this.parseUntilDate(dateStr);
          if (expiryDate !== null && now > expiryDate) {
            reasons.push({
              signal: STALE_SIGNAL.EXPIRED_HINT,
              description: `[${protocol.name}] Directive "${directive}" has expired [until:${dateStr}]`,
            });
          }
        }
      }

      // 3. Orphaned Dependency Signal
      const dependsOn = state.trailers['Depends-on'] || [];
      for (const id of dependsOn) {
        const status = supersessionMap.get(id);
        if (status?.superseded) {
          reasons.push({
            signal: STALE_SIGNAL.ORPHANED_DEP,
            description: `[${protocol.name}] Dependency "${id}" has been superseded by ${status.supersededBy}`,
          });
        }
      }
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

  /**
   * Parse an [until:...] date string.
   */
  private parseUntilDate(dateStr: string): Date | null {
    const monthMatch = dateStr.match(/^(\d{4})-(\d{2})$/);
    if (monthMatch) {
      const year = parseInt(monthMatch[1], 10);
      const month = parseInt(monthMatch[2], 10);
      const d = new Date(year, month, 1);
      return isNaN(d.getTime()) ? null : d;
    }

    const dayMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dayMatch) {
      const year = parseInt(dayMatch[1], 10);
      const month = parseInt(dayMatch[2], 10) - 1;
      const day = parseInt(dayMatch[3], 10);
      const d = new Date(year, month, day, 23, 59, 59, 999);
      return isNaN(d.getTime()) ? null : d;
    }

    return null;
  }
}
