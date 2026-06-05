import { getProtocolIdentity } from '../../core/logic/identity.js';
import { normalizeTrailers } from '../../core/logic/normalization.js';
import { parseTrailers } from '../../core/logic/trailers.js';
import { isValidProtocolIdentity, validateProtocolTrailer } from '../../core/logic/validation.js';
import type { AtomId } from '../../core/types/domain.js';
import type { IGitClient } from '../../interfaces/git-client.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';

/**
 * Utility to read protocol identities from the HEAD commit.
 * Supports multiple protocols via the ProtocolRegistry.
 * 
 * SOLID: SRP -- only responsible for reading the current identity context.
 */
export class HeadIdReader {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly protocolRegistry: ProtocolRegistry,
  ) {}

  /**
   * Returns a map of protocol names to their identity IDs from the HEAD commit.
   */
  async readIds(): Promise<Record<string, AtomId>> {
    try {
      const log = await this.gitClient.log(['-1']);
      if (log.length === 0) return {};

      const trailers = parseTrailers(log[0].trailers);
      const results: Record<string, AtomId> = {};

      for (const ctx of this.protocolRegistry.getAll()) {
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

  /**
   * Backward compatibility alias for the first registered protocol.
   */
  async read(): Promise<AtomId | null> {
    const ids = await this.readIds();
    const first = this.protocolRegistry.getAll()[0];
    if (!first) return null;
    return ids[first.def.name.toLowerCase()] || null;
  }
}
