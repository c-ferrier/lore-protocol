import type { StaleReason, Atom, ProtocolState, SupersessionStatus } from '../types/domain.js';
import type { ProtocolContext } from '../types/protocol-definition.js';
import type { StaleIfCondition } from '../types/config.js';
import { STALE_SIGNAL } from '../../util/constants.js';
import { TriggerParser, parseTriggerHints } from '../../core/logic/trigger-parser.js';
import { getProtocolIdentity } from './identity.js';

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
 * Evaluates staleness signals using DYNAMIC declarative triggers.
 * Pure logic -- consumes ProtocolContext and Atom.
 */
export function getProtocolStaleSignals(
    ctx: ProtocolContext,
    atom: Atom,
    now: Date,
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>,
): StaleReason[] {
    const reasons: StaleReason[] = [];
    const pName = ctx.name;
    const state = atom.protocols.get(pName) || atom.protocols.get(ctx.def.name);
    if (!state) return reasons;

    for (const [key, tDef] of Object.entries(ctx.def.trailers)) {
      if (!tDef?.stale_if) continue;

      const conditions = Array.isArray(tDef.stale_if) ? tDef.stale_if : [tDef.stale_if];
      
      // Search with case-insensitivity against state.trailers
      const actualKey = Object.keys(state.trailers).find(k => k.toLowerCase() === key.toLowerCase()) || key;
      const values = state.trailers[actualKey] || [];

      for (const value of values) {
        for (const condition of conditions) {
            const reason = evaluateStaleCondition(condition, state, key, value, now, globalSupersessionMap, ctx);
            if (reason) reasons.push(reason);
        }
      }
    }
    return reasons;
}

/**
 * Public wrapper for protocol stale signals.
 */
export function getStaleSignals(
    ctx: ProtocolContext,
    atom: Atom,
    now: Date,
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>,
): StaleReason[] {
    return getProtocolStaleSignals(ctx, atom, now, globalSupersessionMap);
}

/**
 * Validates a single stale condition.
 */
export function evaluateStaleCondition(
    condition: StaleIfCondition,
    state: ProtocolState,
    key: string,
    value: string,
    now: Date,
    globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>,
    ctx: ProtocolContext
): StaleReason | null {
    switch (condition.kind) {
      case 'value-equals': {
        if (TriggerParser.strip(value) === condition.value) {
          return {
            signal: condition.signal || STALE_SIGNAL.VALUE_MATCH,
            description: `[${ctx.name}] Atom is marked as ${key}: ${condition.value}`
          };
        }
        break;
      }
      case 'date-expired': {
        const hints = parseTriggerHints(value);
        if (hints.until && now > hints.until) {
          return {
            signal: condition.signal || STALE_SIGNAL.EXPIRED_HINT,
            description: `[${ctx.name}] ${key} "${value}" has expired`
          };
        }
        break;
      }
      case 'reference-superseded': {
        try {
          const currentId = getProtocolIdentity(state, ctx);

          let targetId = value;
          let targetPName = ctx.name;
          if (value.includes('/')) {
            const [prefix, suffix] = value.split('/', 2);
            targetPName = prefix.toLowerCase();
            targetId = suffix;
          }
          const isLocal = targetPName.toLowerCase() === ctx.name.toLowerCase();
          const targetStatusMap = globalSupersessionMap.get(targetPName.toLowerCase());
          const status = targetStatusMap?.get(targetId);

          if (status?.superseded) {
            const supersededByList = Array.isArray(status.supersededBy) ? status.supersededBy : [status.supersededBy];
            
            // Check if superseded by someone ELSE
            const isBySomeoneElse = !isLocal || 
                (!supersededByList.includes(currentId || '') && 
                 !supersededByList.includes(`${targetPName.toLowerCase()}/${currentId}`));

            if (isBySomeoneElse) {
                return {
                    signal: condition.signal || STALE_SIGNAL.ORPHANED_DEP,
                    description: `[${ctx.name}] Dependency "${value}" (in ${key}) has been superseded by ${status.supersededBy.join(', ')}`,
                };
            }
          }
        } catch { /* ignore */ }
        break;
      }
    }
    return null;
}

/**
 * Parse a duration string (e.g. '6m', '1y') into milliseconds.
 */
export function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)([dwmy])$/);
  if (!match) {
      return /^\d+/.test(duration) ? 6 * 30 * 24 * 60 * 60 * 1000 : null;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const msPerDay = 24 * 60 * 60 * 1000;

  switch (unit) {
    case 'd': return value * msPerDay;
    case 'w': return value * 7 * msPerDay;
    case 'm': return value * 30 * msPerDay;
    case 'y': return value * 365 * msPerDay;
    default: return 6 * 30 * msPerDay;
  }
}

/**
 * Format an age in milliseconds to a human-readable string.
 */
export function formatAge(ageMs: number): string {
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  if (days >= 365) return `${Math.floor(days / 365)} year${Math.floor(days / 365) === 1 ? '' : 's'}`;
  if (days >= 30) return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? '' : 's'}`;
  if (days >= 7) return `${Math.floor(days / 7)} week${Math.floor(days / 7) === 1 ? '' : 's'}`;
  return `${days} day${days === 1 ? '' : 's'}`;
}
