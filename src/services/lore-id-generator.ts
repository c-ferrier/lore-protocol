import { randomBytes } from 'node:crypto';
import type { AtomId } from '../types/domain.js';
import { LORE_ID_LENGTH } from '../util/constants.js';

/**
 * Generates 8-character random hex Lore IDs using crypto.randomBytes.
 *
 * GRASP: Pure Fabrication -- ID generation is infrastructure.
 * Extracted for testability (can inject a deterministic generator in tests).
 */
export class LoreIdGenerator {
  /**
   * Generate a new Lore-id.
   * Returns an 8-character lowercase hex string (4 random bytes -> 8 hex chars).
   */
  generate(): AtomId {
    const byteLength = LORE_ID_LENGTH / 2;
    return randomBytes(byteLength).toString('hex');
  }
}
