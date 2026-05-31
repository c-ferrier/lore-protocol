import type { ICommitInputReader } from '../../interfaces/commit-input-reader.js';
import type { CommitInput } from '../../types/commit.js';
import type { CommitCommandOptions } from '../commit-input-resolver.js';
import type { IProtocol } from '../../interfaces/protocol.js';
import type { ProtocolRegistry } from '../protocol-registry.js';
import { slugify, camelCase } from '../../util/string.js';
import { ProtocolError } from '../../util/errors.js';

/**
 * Reads commit input from CLI flag values.
 * 
 * Maps flat CLI flags (e.g. --confidence, --project:team) to the hierarchical CommitInput model.
 */
export class FlagsInputReader implements ICommitInputReader {
  constructor(
    private readonly options: CommitCommandOptions,
    private readonly registry: ProtocolRegistry,
  ) {}

  async read(): Promise<CommitInput> {
    const trailersMap = new Map<string, Record<string, string[]>>();
    const protocols = this.registry.getAll();

    // 1. Dynamically map all authorized trailers from registered flags
    for (const protocol of protocols) {
        const authorizedKeys = protocol.getAuthorizedKeys();
        const ns = protocol.getStorageNamespace();
        const protocolName = protocol.name.toLowerCase();

        for (const key of authorizedKeys) {
            if (key === protocol.identityKey) continue;

            const def = protocol.getDefinition(key);
            if (!def) continue;

            const shortFlag = def.cli?.flag || slugify(key);
            const fullFlag = ns ? `${slugify(ns)}:${shortFlag}` : shortFlag;
            
            const camelShort = camelCase(shortFlag);
            const camelFull = camelCase(fullFlag);
            
            const flagValue = (this.options as Record<string, unknown>)[camelFull] ?? 
                             (this.options as Record<string, unknown>)[fullFlag] ??
                             (this.options as Record<string, unknown>)[camelShort] ?? 
                             (this.options as Record<string, unknown>)[shortFlag];

            if (flagValue !== undefined && flagValue !== null) {
                const pMap = trailersMap.get(protocolName) ?? {};
                pMap[key] = Array.isArray(flagValue) 
                    ? flagValue.map(v => String(v)) 
                    : [String(flagValue)];
                trailersMap.set(protocolName, pMap);
            }
        }
    }

    // 2. Add custom trailers from the catch-all --trailer flag
    const catchAllEntries = this.parseCustomTrailers(this.options.trailer);
    for (const entry of catchAllEntries) {
        const { protocolName: entryProtocolName, key, values } = entry;
        let targetProtocol: IProtocol | undefined;

        // A. Explicitly Qualified (e.g. project/Status=active)
        if (entryProtocolName) {
            targetProtocol = this.registry.get(entryProtocolName);
            if (!targetProtocol) {
               throw new ProtocolError(`Unknown protocol prefix "${entryProtocolName}" in trailer "${key}"`, 1);
            }
        } 
        // B. Unqualified - Strict Disambiguation
        else {
            targetProtocol = this.registry.resolveKey(key);
        }

        if (targetProtocol) {
            const authorizedKey = targetProtocol.authorize(key);
            if (authorizedKey) {
                const pName = targetProtocol.name.toLowerCase();
                const pMap = trailersMap.get(pName) ?? {};
                const existing = pMap[authorizedKey] || [];
                pMap[authorizedKey] = [...existing, ...values];
                trailersMap.set(pName, pMap);
                continue;
            }
        }

        // C. Orphan Fallback (Permissive Root)
        const rootProtocol = this.registry.getRoot();
        if (rootProtocol?.permissive) {
            const pName = rootProtocol.name.toLowerCase();
            const pMap = trailersMap.get(pName) ?? {};
            const existing = pMap[key] || [];
            pMap[key] = [...existing, ...values];
            trailersMap.set(pName, pMap);
        }
    }

    return {
      subject: this.options.subject ?? '',
      body: this.options.body,
      trailers: trailersMap as CommitInput['trailers'],
    };
  }

  /**
   * Parses multiple --trailer Key=Value or Protocol/Key=Value flags.
   */
  private parseCustomTrailers(raw?: string[]): { protocolName: string | null, key: string, values: string[] }[] {
    const results: { protocolName: string | null, key: string, values: string[] }[] = [];
    if (!raw) return results;

    for (const entry of raw) {
      // Support both = and : as delimiters
      const delimiter = entry.includes('=') ? '=' : ':';
      const parts = entry.split(delimiter);
      if (parts.length >= 2) {
        let rawKey = parts[0].trim();
        const value = parts.slice(1).join(delimiter).trim();
        
        let protocolName: string | null = null;
        if (rawKey.includes('/')) {
            const keyParts = rawKey.split('/');
            protocolName = keyParts[0];
            rawKey = keyParts[1];
        }

        if (rawKey && value) {
          results.push({ protocolName, key: rawKey, values: [value] });
        }
      }
    }

    return results;
  }
}
