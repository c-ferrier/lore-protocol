import type { IGitClient } from '../interfaces/git-client.js';
import type { TrailerParser } from './trailer-parser.js';
import type { ProtocolRegistry } from './protocol-registry.js';
import type { AtomId } from '../types/domain.js';

/**
 * Utility to read protocol identities from the HEAD commit.
 * Supports multiple protocols via the ProtocolRegistry.
 * 
 * SOLID: SRP -- only responsible for reading the current identity context.
 */
export class HeadIdReader {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly trailerParser: TrailerParser,
    private readonly protocolRegistry: ProtocolRegistry,
  ) {}

  /**
   * Returns a map of protocol names to their identity IDs from the HEAD commit.
   */
  async readIds(): Promise<Record<string, AtomId>> {
    try {
      const log = await this.gitClient.log(['-1']);
      if (log.length === 0) return {};

      const trailers = this.trailerParser.parse(log[0].trailers);
      const results: Record<string, AtomId> = {};

      for (const protocol of this.protocolRegistry.getAll()) {
        const state = protocol.normalize(trailers);
        const id = protocol.getIdentity(state);
        if (id && protocol.isValidIdentity(id)) {
            results[protocol.name.toLowerCase()] = id;
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
    return ids[first.name.toLowerCase()] || null;
  }
}
