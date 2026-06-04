import { randomBytes, randomUUID } from 'node:crypto';
import type { AtomId, ProtocolState } from '../types/domain.js';
import type { ProtocolContext } from '../types/protocol-definition.js';
import { ConfigurationError } from '../../util/errors.js';

/**
 * Generates a unique identifier based on the protocol's generator setting.
 * Pure logic: takes protocol context, returns new ID string.
 */
export function generateId(ctx: ProtocolContext): AtomId {
  // Support method override via the definition object (used by mocks in tests)
  if ((ctx.def as any).generateId) return (ctx.def as any).generateId();

  const { def } = ctx;
  const tDef = def.trailers[def.identityKey];
  const strategy = tDef?.generator || 'hex8';

  switch (strategy) {
    case 'hex8':
      return randomBytes(4).toString('hex');
    case 'uuid':
      return randomUUID();
    case 'none':
      throw new ConfigurationError(`Protocol "${def.name}" does not support automatic identity generation (generator is 'none').`);
    default:
      throw new ConfigurationError(`Unknown generator strategy "${strategy}" for protocol "${def.name}".`);
  }
}

/**
 * Extracts the primary identity value from a protocol state.
 */
export function getProtocolIdentity(state: ProtocolState | undefined | null, ctx: ProtocolContext): string | null {
    if (!state) return null;
    
    // Support method override via the definition object (used by mocks in tests)
    if ((ctx.def as any).getIdentity) return (ctx.def as any).getIdentity(state);

    const values = state.trailers[ctx.identityKey];
    if (!values || values.length === 0) return null;
    return values[0];
}
