import { ProtocolError } from '../../util/errors.js';
import { ProtocolMap } from '../models/protocol-map.js';
import type { CommitInput } from '../types/commit.js';
import type { Atom, AtomId } from '../types/domain.js';
import type { ProtocolContext } from '../types/protocol-definition.js';

/**
 * Merge a collection of atoms into a single enriched commit input (used for squashing).
 * 
 * SOLID: SRP -- responsible only for combining atom data mathematically based on squash rules.
 */
export function squashAtoms(
  atoms: readonly Atom[],
  options: { subject?: string; body?: string },
  protocols: ProtocolMap<ProtocolContext>
): CommitInput {
  if (atoms.length === 0) {
    throw new ProtocolError('Cannot merge zero atoms', 1);
  }

  const trailers = new ProtocolMap<Record<string, string[]>>();

  // Sort atoms by date ascending so the newest is last
  const sorted = [...atoms].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  const newest = sorted[sorted.length - 1];

  // Subject: use option or newest atom's subject
  const subject = options.subject ?? newest.subject;

  // Body: use option or concatenate body summaries
  const body = options.body ?? mergeBodySummaries(sorted);

  // Process each protocol for trailers
  for (const ctx of protocols.values()) {
    const pName = ctx.def.name.toLowerCase();
    
    const internalIds = new Set(atoms
      .map((a) => {
        const state = a.protocols.get(pName);
        if (!state) return null;
        const values = state.trailers[ctx.def.identityKey];
        return (values && values[0]) || null;
      })
      .filter((id): id is string => Boolean(id))
    );

    // Collect all present keys for this protocol across all atoms
    const allKeys = new Set<string>();
    for (const atom of atoms) {
      const state = atom.protocols.get(pName);
      if (!state) continue;

      for (const key of Object.keys(state.trailers)) {
        if (key !== ctx.def.identityKey) { 
          allKeys.add(key);
        }
      }
    }

    const sortedKeys = Array.from(allKeys).sort((a, b) => {
      const defA = ctx.def.trailers[a];
      const defB = ctx.def.trailers[b];
      const orderA = defA?.prompt?.order ?? 1000;
      const orderB = defB?.prompt?.order ?? 1000;
      return orderA - orderB;
    });

    const mergedProtocolTrailers: Record<string, string[]> = {};

    for (const key of sortedKeys) {
      const def = ctx.def.trailers[key];
      const strategy = def?.squash || 'union';
      
      const allValues = atoms.map(a => a.protocols.get(pName)?.trailers[key] || []);

      if (strategy === 'rank-min' && def?.values) {
        const valueKeys = Object.keys(def.values);
        const scalars = allValues.map(v => v[0] || null);
        const merged = pickMinRank(scalars, valueKeys);
        if (merged !== null) mergedProtocolTrailers[key] = [merged];
      } else if (strategy === 'rank-max' && def?.values) {
        const valueKeys = Object.keys(def.values);
        const scalars = allValues.map(v => v[0] || null);
        const merged = pickMaxRank(scalars, valueKeys);
        if (merged !== null) mergedProtocolTrailers[key] = [merged];
      } else {
        // Default: Union + Dedup
        let merged = unionDedup(allValues as string[][]);
        
        if (def?.ui?.kind === 'reference') {
          merged = filterExternal(merged, internalIds);
        }

        if (merged.length > 0) {
            mergedProtocolTrailers[key] = merged;
        }
      }
    }
    
    // Only set if we found any trailers to merge
    if (Object.keys(mergedProtocolTrailers).length > 0) {
      trailers.set(pName, mergedProtocolTrailers);
    }
  }

  return {
      subject,
      body,
      trailers
  };
}

/**
 * Extract summary line from atom body
 */
function getSummary(atom: Atom): string {
  if (!atom.body) return '';
  const firstLine = atom.body.split('\n')[0].trim();
  return firstLine || '';
}

/**
 * Merge bodies of multiple atoms
 */
function mergeBodySummaries(atoms: Atom[]): string {
  const summaries: string[] = [];
  for (const a of atoms) {
    const s = getSummary(a);
    if (s && !summaries.includes(`- ${s}`)) {
      summaries.push(`- ${s}`);
    }
  }
  return summaries.length > 0 ? summaries.join('\n') : '';
}

/**
 * Union and deduplicate a 2D array of string values.
 */
function unionDedup(arrays: readonly string[][]): string[] {
  const result: string[] = [];
  for (const arr of arrays) {
    if (!arr) continue;
    for (const item of arr) {
      if (!result.includes(item)) {
        result.push(item);
      }
    }
  }
  return result;
}

/**
 * Remove internal references to atoms that are being merged into the same squash.
 */
function filterExternal(
  values: string[],
  internalIds: Set<AtomId>,
): string[] {
  return values.filter((v) => !internalIds.has(v));
}

/**
 * Pick the value with the lowest index in the order.
 */
function pickMinRank<T extends string>(
  values: readonly (T | null)[],
  order: readonly T[],
): T | null {
  let lowestIndex = -1;
  let result: T | null = null;

  for (const val of values) {
    if (val === null || val === undefined) continue;
    const idx = order.indexOf(val);
    if (idx === -1) continue;
    if (result === null || idx < lowestIndex) {
      lowestIndex = idx;
      result = val;
    }
  }

  return result;
}

/**
 * Pick the value with the highest index in the order.
 */
function pickMaxRank<T extends string>(
  values: readonly (T | null)[],
  order: readonly T[],
): T | null {
  let highestIndex = -1;
  let result: T | null = null;

  for (const val of values) {
    if (val === null || val === undefined) continue;
    const idx = order.indexOf(val);
    if (idx === -1) continue;
    if (result === null || idx > highestIndex) {
      highestIndex = idx;
      result = val;
    }
  }

  return result;
}
