import type { StaleReason } from '../types/domain.js';
import { STALE_SIGNAL } from '../../util/constants.js';

/**
 * Check if an atom's absolute age exceeds the threshold.
 */
export function evaluateAgeSignal(atomDate: Date, now: Date, thresholdStr: string): StaleReason | null {
  const thresholdMs = parseDuration(thresholdStr);
  if (thresholdMs === null) return null;

  const ageMs = now.getTime() - atomDate.getTime();
  if (ageMs > thresholdMs) {
    return {
      signal: STALE_SIGNAL.AGE,
      description: `Atom is older than ${thresholdStr} (${formatAge(ageMs)})`,
    };
  }
  
  return null;
}

/**
 * Check if the files associated with the atom have changed significantly.
 * 
 * @param driftMap A map of file paths to their commit counts since the atom was created.
 * @param threshold The maximum allowed commit count.
 */
export function evaluateDriftSignal(driftMap: Record<string, number>, threshold: number): StaleReason | null {
  const driftedFiles = Object.entries(driftMap)
    .filter(([_, count]) => count > threshold)
    .map(([file]) => file);

  if (driftedFiles.length > 0) {
    return {
      signal: STALE_SIGNAL.DRIFT,
      description: `Source files have drifted (${driftedFiles.length} files with >${threshold} commits)`,
    };
  }
  
  return null;
}

/**
 * Parse a duration string (e.g. '6m', '1y') into milliseconds.
 */
export function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)([dwmy])$/);
  if (!match) {
      // If it doesn't match the standard format but has digits, default to 6 months
      return /^\d+/.test(duration) ? 6 * 30 * 24 * 60 * 60 * 1000 : null;
  }

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
export function formatAge(ageMs: number): string {
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
