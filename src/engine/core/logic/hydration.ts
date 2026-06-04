import { ProtocolMap, type Atom, type ProtocolState } from '../types/domain.js';
import type { RawCommit } from '../../interfaces/git-client.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';
import type { QueryIdentity } from '../types/query.js';
import { escapeRegex } from '../../util/regex.js';

/**
 * Hydrates raw Git commit data into domain-rich Atoms.
 * Pure function: takes data and registry, returns interpreted atoms.
 */
export function hydrateAtoms(rawCommits: readonly RawCommit[], registry: ProtocolRegistry): Atom[] {
  const results: Atom[] = [];
  const allProtocols = registry.getAll();
  const hasProtocols = allProtocols.length > 0;
  const claimedKeys = registry.getClaimedKeys();

  for (const raw of rawCommits) {
    const activeProtocols = registry.detect(raw.trailers);
    
    // If we have protocols registered, we only care about commits they claim.
    if (hasProtocols && activeProtocols.length === 0) continue;

    const protocolMap = new ProtocolMap<ProtocolState>();
    
    if (hasProtocols) {
      for (const p of activeProtocols) {
        protocolMap.set(p.name, p.parse(raw.trailers, claimedKeys));
      }
    }

    results.push({
      commitHash: raw.hash,
      date: new Date(raw.date),
      author: raw.author,
      subject: raw.subject,
      body: stripTrailersFromBody(raw.body, raw.trailers),
      filesChanged: raw.filesChanged,
      protocols: protocolMap,
    });
  }

  return results;
}

/**
 * Extract reference identities from a set of Atoms.
 * Useful for BFS traversal and relationship mapping.
 */
export function extractReferenceIds(atoms: readonly Atom[], registry: ProtocolRegistry): QueryIdentity[] {
  const identities: QueryIdentity[] = [];
  const seen = new Set<string>();

  for (const atom of atoms) {
    for (const [pName, state] of atom.protocols) {
      const protocol = registry.get(pName);
      if (!protocol) continue;

      const refKeys = protocol.getReferenceKeys();
      for (const key of refKeys) {
        const values = state.trailers[key] || [];
        for (const val of values) {
          try {
            const identity = registry.resolveIdentity(val, pName);
            const idKey = `${identity.protocol}/${identity.id}`;
            if (!seen.has(idKey)) {
              seen.add(idKey);
              identities.push(identity);
            }
          } catch (e) {
            // Skip invalid references during extraction (they will be caught by validator)
          }
        }
      }
    }
  }

  return identities;
}
/**
 * Remove the trailer block from the commit body to avoid redundant display.
 */
function stripTrailersFromBody(body: string, trailersRaw: string): string {
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
