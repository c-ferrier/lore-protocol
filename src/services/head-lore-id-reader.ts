import type { IGitClient } from '../interfaces/git-client.js';
import type { TrailerParser } from './trailer-parser.js';
import type { IProtocol } from '../interfaces/protocol.js';
import { LORE_ID_PATTERN } from '../util/constants.js';
import type { AtomId } from '../types/domain.js';

/**
 * Utility to read the decision identity (e.g. Lore-id) from the HEAD commit.
 * 
 * SOLID: SRP -- only responsible for reading the current identity context.
 */
export class HeadLoreIdReader {
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
      const idArray = trailers[this.protocol.identityKey];
      
      if (idArray && idArray.length > 0 && LORE_ID_PATTERN.test(idArray[0])) {
        return idArray[0];
      }
      return null;
    } catch {
      return null;
    }
  }
}
