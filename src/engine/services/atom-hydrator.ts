import type { IGitClient, RawCommit } from '../interfaces/git-client.js';
import type { IAtomCache } from '../interfaces/atom-cache.js';
import type { ProtocolRegistry } from './protocol-registry.js';
import type { TrailerParser } from './trailer-parser.js';
import type { Atom, ProtocolState } from '../types/domain.js';
import type { QueryIdentity } from '../types/query.js';
import { GIT_FILES_CHANGED_BATCH_SIZE } from '../util/constants.js';
import { escapeRegex } from '../util/regex.js';

/**
 * Hydrates raw Git commit data into domain-rich Atoms.
 * Responsible for parsing trailers, interpreting protocol state, 
 * and fetching associated metadata (like changed files).
 * 
 * DESIGN: This is the "Interpreter" service. It knows how to translate 
 * storage-specific records into the decision engine's domain model.
 */
export class AtomHydrator {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly trailerParser: TrailerParser,
    private readonly protocolRegistry: ProtocolRegistry,
    private readonly atomCache: IAtomCache,
  ) {}

  /**
   * Parse an array of RawCommit into Atom[], filtering out non-protocol commits.
   */
  async hydrate(rawCommits: readonly RawCommit[]): Promise<Atom[]> {
    const results: Atom[] = [];
    const hashesToFetchFiles: string[] = [];

    const allProtocols = this.protocolRegistry.getAll();
    const hasProtocols = allProtocols.length > 0;

    // First pass: Filter and parse protocols
    const parsedData: Array<{ raw: RawCommit; protocols: Map<string, ProtocolState> }> = [];

    for (const raw of rawCommits) {
      const activeProtocols = this.protocolRegistry.detect(raw.trailers);
      
      // If we have protocols registered, we only care about commits they claim.
      if (hasProtocols && activeProtocols.length === 0) continue;

      const protocolMap = new Map<string, ProtocolState>();
      
      if (hasProtocols) {
        // Ownership resolution logic:
        const claimedKeys = this.protocolRegistry.getClaimedKeys();

        for (const p of activeProtocols) {
          protocolMap.set(p.name.toLowerCase(), p.parse(raw.trailers, claimedKeys));
        }
      }

      parsedData.push({ raw, protocols: protocolMap });
      hashesToFetchFiles.push(raw.hash);
    }

    // Second pass: Fetch files in parallel batches
    const fileMap = await this.batchFetchFiles(hashesToFetchFiles);

    // Final pass: Build Atom objects
    for (const { raw, protocols } of parsedData) {
      const files = fileMap.get(raw.hash) || [];
      results.push({
        commitHash: raw.hash,
        date: new Date(raw.date),
        author: raw.author,
        subject: raw.subject,
        body: this.stripTrailersFromBody(raw.body, raw.trailers),
        filesChanged: files,
        protocols,
      });
    }

    return results;
  }

  /**
   * Extract reference identities from a set of Atoms.
   * Useful for BFS traversal and relationship mapping.
   */
  extractReferenceIds(atoms: readonly Atom[]): QueryIdentity[] {
    const identities: QueryIdentity[] = [];
    const seen = new Set<string>();
    
    for (const atom of atoms) {
      for (const [pName, state] of atom.protocols) {
        const protocol = this.protocolRegistry.get(pName);
        if (!protocol) continue;

        const refKeys = protocol.getReferenceKeys();
        for (const key of refKeys) {
          const values = state.trailers[key] || [];
          for (const val of values) {
            try {
              const identity = this.protocolRegistry.resolveIdentity(val, pName);
              const key = `${identity.protocol}/${identity.id}`;
              if (!seen.has(key)) {
                seen.add(key);
                identities.push(identity);
              }
            } catch {
              // Skip invalid references during extraction (they will be caught by validator)
            }
          }
        }
      }
    }

    return identities;
  }

  private async batchFetchFiles(hashes: readonly string[]): Promise<Map<string, readonly string[]>> {
    const result = new Map<string, readonly string[]>();
    
    // 1. Parallel Cache Lookup
    const cacheResults = await Promise.all(hashes.map(h => this.atomCache.get(h)));
    
    const missingHashes: string[] = [];
    for (let i = 0; i < hashes.length; i++) {
      const hash = hashes[i];
      const cached = cacheResults[i];
      if (cached) {
        result.set(hash, cached.filesChanged);
      } else {
        missingHashes.push(hash);
      }
    }

    if (missingHashes.length === 0) return result;

    // Process missing hashes in chunks
    for (let i = 0; i < missingHashes.length; i += GIT_FILES_CHANGED_BATCH_SIZE) {
      const chunk = missingHashes.slice(i, i + GIT_FILES_CHANGED_BATCH_SIZE);
      const chunkResults = await this.gitClient.getFilesChanged(chunk);
      
      for (const [hash, files] of chunkResults.entries()) {
        result.set(hash, files);
        // Background cache update
        this.atomCache.set(hash, { filesChanged: files }).catch(() => {});
      }
    }

    return result;
  }

  /**
   * Remove the trailer block from the commit body to avoid redundant display.
   */
  private stripTrailersFromBody(body: string, trailersRaw: string): string {
    if (!trailersRaw || !body) return body;

    // Create a flexible regex that handles varying whitespace and indentation
    const trailerLines = trailersRaw.trim().split('\n').filter(l => l.trim() !== '');
    if (trailerLines.length === 0) return body;

    const escapedLines = trailerLines.map(l => {
      const [key, ...valParts] = l.split(':');
      const val = valParts.join(':').trim();
      return `\\s*${escapeRegex(key.trim())}:\\s*${escapeRegex(val)}\\s*`;
    });

    const flexiblePattern = escapedLines.join('\n') + '\\s*$';
    
    try {
      const trailerRegex = new RegExp(flexiblePattern, 'm');
      if (trailerRegex.test(body)) {
        return body.replace(trailerRegex, '').trim();
      }
    } catch {
      // Best effort
    }

    return body;
  }
}
