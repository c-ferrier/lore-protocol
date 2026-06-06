import { getProtocolIdentity } from '../../core/logic/identity.js';
import { normalizeTrailers } from '../../core/logic/normalization.js';
import { parseTrailers } from '../../core/logic/trailers.js';
import { isValidProtocolIdentity } from '../../core/logic/validation.js';
import type { AtomId } from '../../core/types/domain.js';
import type { IGitClient } from '../../interfaces/git-client.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';

/**
 * Reads protocol identities from the HEAD commit.
 * Supports multiple protocols via the ProtocolRegistry.
 * 
 * SOLID: SRP -- only responsible for reading the current identity context.
 * Tier: Shell Orchestrator (Functional)
 */
export async function readHeadIdentities(
  gitClient: IGitClient,
  protocolRegistry: ProtocolRegistry,
): Promise<Record<string, AtomId>> {
  try {
    const log = await gitClient.log(['-1']);
    if (log.length === 0) return {};

    const trailers = parseTrailers(log[0].trailers);
    const results: Record<string, AtomId> = {};

    for (const ctx of protocolRegistry.getAll()) {
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
