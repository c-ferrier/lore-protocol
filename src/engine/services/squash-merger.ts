import type { IdGenerator } from './id-generator.js';
import type { Atom, AtomId } from '../types/domain.js';
import type { IProtocol } from '../interfaces/protocol.js';
import type { ProtocolRegistry } from './protocol-registry.js';

/**
 * Orchestrates the merging of multiple decision atoms during a git squash.
 * Now supports multi-protocol squashing.
 * 
 * SOLID: SRP -- responsible only for combining atom data into a single message.
 * SOLID: OCP -- metadata-driven merging logic for all protocol trailers.
 * GRASP: Creator -- knows how to synthesize context from multiple lineage atoms.
 */
export class SquashMerger {
  constructor(
    private readonly idGenerator: IdGenerator,
    private readonly protocolRegistry: ProtocolRegistry,
  ) {}

  /**
   * Merge a collection of atoms into a single enriched commit message.
   */
  merge(
    atoms: readonly Atom[],
    options: { subject?: string; body?: string },
  ): { message: string; protocols: Record<string, any> } {
    if (atoms.length === 0) {
      throw new Error('Cannot merge zero atoms');
    }

    const registeredProtocols = this.protocolRegistry.getAll();
    const protocols: Record<string, any> = {};
    const trailerLines: string[] = [];

    // Sort atoms by date ascending so the newest is last
    const sorted = [...atoms].sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );
    const newest = sorted[sorted.length - 1];

    // Subject: use option or newest atom's subject
    const subject = options.subject ?? newest.subject;

    // Body: use option or concatenate body summaries
    const body = options.body ?? this.mergeBodySummaries(sorted);

    // 1. Process each protocol for identity and trailers
    for (const protocol of registeredProtocols) {
      const pName = protocol.name.toLowerCase();
      const newId = this.idGenerator.generate(protocol);
      
      protocols[pName] = {
        id: newId,
        identity_key: protocol.identityKey,
        version: protocol.version,
      };

      const prefix = protocol.namespace ? `${protocol.namespace}/` : '';
      const identityKey = `${prefix}${protocol.identityKey}`;
      trailerLines.push(`${identityKey}: ${newId}`);

      const internalIds = new Set(atoms
        .map((a) => protocol.getIdentity(a.protocols.get(pName)))
        .filter((id): id is string => Boolean(id))
      );

      // Collect all present keys for this protocol across all atoms
      const allKeys = new Set<string>();
      for (const atom of atoms) {
        const state = atom.protocols.get(pName);
        if (!state) continue;

        for (const key of Object.keys(state.trailers)) {
          if (key !== protocol.identityKey) { 
            allKeys.add(key);
          }
        }
      }

      const sortedKeys = Array.from(allKeys).sort((a, b) => {
        const defA = protocol.getDefinition(a);
        const defB = protocol.getDefinition(b);
        const orderA = defA?.prompt?.order ?? 1000;
        const orderB = defB?.prompt?.order ?? 1000;
        return orderA - orderB;
      });

      for (const key of sortedKeys) {
        const fullKey = `${prefix}${key}`;
        const def = protocol.getDefinition(key);
        const strategy = def?.squash || 'union';
        
        const allValues = atoms.map(a => a.protocols.get(pName)?.trailers[key] || []);

        if (strategy === 'rank-min' && def?.values) {
          const valueKeys = Object.keys(def.values);
          const scalars = allValues.map(v => v[0] || null);
          const merged = this.pickMinRank(scalars, valueKeys);
          if (merged !== null) trailerLines.push(`${fullKey}: ${merged}`);
        } else if (strategy === 'rank-max' && def?.values) {
          const valueKeys = Object.keys(def.values);
          const scalars = allValues.map(v => v[0] || null);
          const merged = this.pickMaxRank(scalars, valueKeys);
          if (merged !== null) trailerLines.push(`${fullKey}: ${merged}`);
        } else {
          // Default: Union + Dedup
          let merged = this.unionDedup(allValues);
          
          if (def?.ui?.kind === 'reference') {
            merged = this.filterExternal(merged, internalIds);
          }

          for (const v of merged) {
            trailerLines.push(`${fullKey}: ${v}`);
          }
        }
      }
    }

    // Assemble message
    const parts: string[] = [subject];

    if (body) {
      parts.push('');
      parts.push(body);
    }

    parts.push('');
    parts.push(trailerLines.join('\n'));

    return { message: parts.join('\n'), protocols };
  }

  /**
   * Combine body summaries from multiple atoms into a single narrative block.
   */
  private mergeBodySummaries(sortedAtoms: readonly Atom[]): string {
    const summaries: string[] = [];
    for (const atom of sortedAtoms) {
      if (atom.body.trim()) {
        summaries.push(atom.body.trim());
      }
    }
    return summaries.join('\n\n');
  }

  /**
   * Deduplicate and merge multiple trailer value arrays into one.
   */
  private unionDedup(arrays: readonly (readonly string[])[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const arr of arrays) {
      for (const item of arr) {
        if (!seen.has(item)) {
          seen.add(item);
          result.push(item);
        }
      }
    }
    return result;
  }

  /**
   * Remove internal references to atoms that are being merged into the same squash.
   */
  private filterExternal(
    values: string[],
    internalIds: Set<AtomId>,
  ): string[] {
    return values.filter((v) => !internalIds.has(v));
  }

  /**
   * Pick the value with the lowest index in the order.
   */
  private pickMinRank<T extends string>(
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
  private pickMaxRank<T extends string>(
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
}
