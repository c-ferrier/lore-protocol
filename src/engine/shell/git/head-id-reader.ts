import { getProtocolIdentity } from '../../core/logic/identity.js';
import { normalizeTrailers } from '../../core/logic/normalization.js';
import { parseTrailers } from '../../core/logic/trailers.js';
import { isValidProtocolIdentity } from '../../core/logic/validation.js';
import { type AtomId,ProtocolMap } from '../../core/types/domain.js';
import type { ProtocolContext } from '../../core/types/protocol-definition.js';
import type { IGitClient } from '../../interfaces/git-client.js';

/**
 * Reads protocol identities from the HEAD commit.
 * Supports multiple protocols via the ProtocolMap.
 * 
 * SOLID: SRP -- only responsible for reading the current identity context.
 * Tier: Shell Orchestrator (Functional)
 */
export async function readHeadIdentities(
  gitClient: IGitClient,
  protocols: ProtocolMap<ProtocolContext>,
): Promise<Record<string, AtomId>> {
  try {
    const log = await gitClient.log(['-1']);
    if (log.length === 0) return {};

    const trailers = parseTrailers(log[0].trailers);
    const results: Record<string, AtomId> = {};

    for (const ctx of protocols.values()) {
      const state = normalizeTrailers(trailers, ctx);
      const id = getProtocolIdentity(state, ctx);
      if (id && isValidProtocolIdentity(id, ctx.def)) {
          results[ctx.def.name.toLowerCase()] = id;
      }
    }
    
    return results;
  } catch {
    return {};
  }
}
