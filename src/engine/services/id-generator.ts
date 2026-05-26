import { randomBytes, randomUUID } from 'node:crypto';
import type { AtomId } from '../types/domain.js';
import type { IProtocol } from '../interfaces/protocol.js';

/**
 * Generates unique identifiers based on the protocol schema.
 *
 * GRASP: Pure Fabrication -- ID generation is infrastructure.
 * Extracted for testability (can inject a deterministic generator in tests).
 */
export class IdGenerator {
  /**
   * Generate a new identity based on the protocol's generator setting.
   * Throws an error if the generator is 'none' or unknown.
   */
  generate(protocol: IProtocol): AtomId {
    const def = protocol.getDefinition(protocol.identityKey);
    const strategy = def?.generator || 'hex8';

    switch (strategy) {
      case 'hex8':
        return randomBytes(4).toString('hex');
      case 'uuid':
        return randomUUID();
      case 'none':
        throw new Error(`Protocol "${protocol.name}" does not support automatic identity generation (generator is 'none').`);
      default:
        throw new Error(`Unknown generator strategy "${strategy}" for protocol "${protocol.name}".`);
    }
  }
}
