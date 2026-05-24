import { randomBytes } from 'node:crypto';
import type { AtomId } from '../types/domain.js';

/**
 * Generates 8-character random hex IDs using crypto.randomBytes.
 *
 * GRASP: Pure Fabrication -- ID generation is infrastructure.
 * Extracted for testability (can inject a deterministic generator in tests).
 */
export class IdGenerator {
  /**
   * Generate a new identity.
   * Returns an 8-character lowercase hex string (4 random bytes -> 8 hex chars).
   */
  generate(): AtomId {
    return randomBytes(4).toString('hex');
  }
}
