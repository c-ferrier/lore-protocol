import type { RawCommit } from '../../interfaces/git-client.js';
import { claimsTrailers } from '../../shell/git/protocol-query-adapter.js';
import { type Atom, ProtocolMap, type ProtocolState } from '../types/domain.js';
import type { ProtocolContext } from '../types/protocol-definition.js';
import type { QueryIdentity } from '../types/query.js';
import { normalizeTrailers } from './normalization.js';
import { getClaimedProtocolKeys, resolveProtocolIdentity } from './protocols.js';
import { escapeRegex } from './regex.js';
import { parseTrailers } from './trailers.js';

/**
 * Hydrates raw Git commit data into domain-rich Atoms.
 * Pure function: takes data and protocol map, returns interpreted atoms.
 */
export function hydrateAtoms(
  rawCommits: readonly RawCommit[],
  protocols: ProtocolMap<ProtocolContext>,
  options: { includeAllCommits?: boolean } = {},
): Atom[] {
  const results: Atom[] = [];
  const allProtocols = Array.from(protocols.values());
  const hasProtocols = allProtocols.length > 0;
  const claimedKeys = getClaimedProtocolKeys(protocols);

  for (const raw of rawCommits) {
    const activeProtocols = allProtocols.filter(p => claimsTrailers(raw.trailers, p));

    // If we are NOT in history mode, skip commits that match zero protocols
    if (!options.includeAllCommits && hasProtocols && activeProtocols.length === 0) continue;

    const protocolMap = new ProtocolMap<ProtocolState>();
    const parsedRaw = parseTrailers(raw.trailers);

    if (hasProtocols) {
      for (const p of activeProtocols) {
        protocolMap.set(p.name.toLowerCase(), normalizeTrailers(parsedRaw, p, claimedKeys));
      }
    }

    results.push({
      commitHash: raw.hash,
      date: new Date(raw.date),
      author: raw.author,
      subject: raw.subject,
      rawTrailers: raw.trailers || '',
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
export function extractReferenceIds(atoms: readonly Atom[], protocols: ProtocolMap<ProtocolContext>): QueryIdentity[] {
  const identities: QueryIdentity[] = [];
  const seen = new Set<string>();

  for (const atom of atoms) {
    for (const [pName, state] of atom.protocols) {
      const p = protocols.get(pName);
      if (!p) continue;

      const refKeys = Object.keys(p.def.trailers).filter(k => p.def.trailers[k].validation === 'reference');
      for (const key of refKeys) {
        const values = state.trailers[key] || [];
        for (const val of values) {
          try {
            const identity = resolveProtocolIdentity(protocols, val, pName);
            const pNameFinal = (identity.protocol || pName).toLowerCase();
            const idKey = `${pNameFinal}/${identity.id}`;
            if (!seen.has(idKey)) {
              seen.add(idKey);
              identities.push(identity);
            }
          } catch (_e) {
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
      return body.replace(trailerRegex, '').trimEnd();
    }
  } catch {
    // Best effort
  }

  return body;
}
