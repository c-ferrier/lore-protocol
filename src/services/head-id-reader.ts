import type { IGitClient } from '../interfaces/git-client.js';
import type { TrailerParser } from './trailer-parser.js';
import type { IProtocol } from '../interfaces/protocol.js';
import type { AtomId } from '../types/domain.js';

/**
 * Utility to read the decision identity (e.g. identity-id) from the HEAD commit.
 * 
 * SOLID: SRP -- only responsible for reading the current identity context.
 */
export class HeadIdReader {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly trailerParser: TrailerParser,
    private readonly protocol: IProtocol,
  ) {}

  /**
   * Returns the identity key value from the HEAD commit, or null if missing.
   */
  async read(): Promise<AtomId | null> {
    try {
      const log = await this.gitClient.log(['-1']);
      if (log.length === 0) return null;

      const trailers = this.trailerParser.parse(log[0].trailers);
      const id = this.protocol.getIdentity(trailers);
      
      if (id && this.protocol.isValidIdentity(id)) {
        return id;
      }
      return null;
    } catch {
      return null;
    }
  }
}
