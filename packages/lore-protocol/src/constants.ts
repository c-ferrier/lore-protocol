/**
 * Lore-specific staleness signals.
 * These are returned by the Lore protocol definition and are not part of the core engine.
 */
export const LORE_STALE_SIGNAL = {
  LOW_CONFIDENCE: 'low-confidence' as const,
  EXPIRED_HINT: 'expired-hint' as const,
};
