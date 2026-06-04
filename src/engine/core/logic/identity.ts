import { randomBytes, randomUUID } from 'node:crypto';
import type { AtomId } from '../types/domain.js';
import type { ActiveProtocol } from '../models/active-protocol.js';
import { ConfigurationError } from '../../util/errors.js';

/**
 * Generates a unique identifier based on the protocol's generator setting.
 * Pure logic: takes protocol definition, returns new ID string.
 */
export function generateId(protocol: ActiveProtocol): AtomId {
  const def = protocol.getDefinition(protocol.identityKey);
  const strategy = def?.generator || 'hex8';

  switch (strategy) {
    case 'hex8':
      return randomBytes(4).toString('hex');
    case 'uuid':
      return randomUUID();
    case 'none':
      throw new ConfigurationError(`Protocol "${protocol.name}" does not support automatic identity generation (generator is 'none').`);
    default:
      throw new ConfigurationError(`Unknown generator strategy "${strategy}" for protocol "${protocol.name}".`);
  }
}
