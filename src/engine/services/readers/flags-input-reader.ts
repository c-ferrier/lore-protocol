import type { ICommitInputReader } from '../../interfaces/commit-input-reader.js';
import type { CommitInput } from '../../types/commit.js';
import type { CommitCommandOptions } from '../commit-input-resolver.js';
import type { IProtocol } from '../../interfaces/protocol.js';
import { slugify, camelCase } from '../../util/string.js';

/**
 * Reads commit input from CLI flag values.
 * 
 * Maps flat CLI flags (e.g. --confidence, --project:team) to the hierarchical CommitInput model.
 * 
 * GRASP: Information Expert -- uses protocol metadata to dynamically map core and custom flags.
 * SOLID: SRP -- only responsible for mapping CLI flag options to CommitInput.
 */
export class FlagsInputReader implements ICommitInputReader {
  constructor(
    private readonly options: CommitCommandOptions,
    private readonly protocols: readonly IProtocol[],
  ) {}

  async read(): Promise<CommitInput> {
    const trailers: Record<string, Record<string, string[]>> = {};

    for (const protocol of this.protocols) {
        const authorizedKeys = protocol.getAuthorizedKeys();
        const ns = protocol.namespace;

        // 1. Dynamically map all authorized trailers from registered flags
        for (const key of authorizedKeys) {
            if (key === protocol.identityKey) continue;

            const def = protocol.getDefinition(key);
            if (!def) continue;

            // Flag Precedence:
            // 1. Root protocol uses short flags (--confidence)
            // 2. Namespaced protocols use colon notation (--project:team)
            const shortFlag = def.cli?.flag || slugify(key);
            const fullFlag = ns ? `${slugify(ns)}:${shortFlag}` : shortFlag;
            
            const camelShort = camelCase(shortFlag);
            const camelFull = camelCase(fullFlag);
            
            // Commander parses --ns:key as ns:key in the options object
            const flagValue = (this.options as Record<string, unknown>)[camelFull] ?? 
                             (this.options as Record<string, unknown>)[fullFlag] ??
                             (this.options as Record<string, unknown>)[camelShort] ?? 
                             (this.options as Record<string, unknown>)[shortFlag];

            if (flagValue !== undefined && flagValue !== null) {
                const nsMap = trailers[ns] ?? {};
                nsMap[key] = Array.isArray(flagValue) 
                    ? flagValue.map(v => String(v)) 
                    : [String(flagValue)];
                trailers[ns] = nsMap;
            }
        }
    }

    // 2. Add custom trailers from the catch-all --trailer flag
    const catchAllMap = this.parseCustomTrailers(this.options.trailer);
    for (const [key, values] of catchAllMap) {
        // Try to authorize against ANY protocol
        let claimed = false;
        for (const protocol of this.protocols) {
            const authorizedKey = protocol.authorize(key);
            if (authorizedKey) {
                const ns = protocol.namespace;
                const nsMap = trailers[ns] ?? {};
                const existing = nsMap[authorizedKey] || [];
                nsMap[authorizedKey] = [...existing, ...values];
                trailers[ns] = nsMap;
                claimed = true;
                break; // First protocol that claims it wins
            }
        }

        // If unclaimed, route to root namespace if root protocol is permissive
        if (!claimed) {
            const rootProtocol = this.protocols.find(p => p.namespace === '');
            if (rootProtocol?.permissive) {
                const nsMap = trailers[''] ?? {};
                const existing = nsMap[key] || [];
                nsMap[key] = [...existing, ...values];
                trailers[''] = nsMap;
            }
        }
    }

    return {
      subject: this.options.subject ?? '',
      body: this.options.body,
      trailers,
    };
  }

  /**
   * Parses multiple --trailer Key=Value or Key:Value flags.
   */
  private parseCustomTrailers(raw?: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (!raw) return map;

    for (const entry of raw) {
      // Support both = and : as delimiters
      const parts = entry.includes('=') ? entry.split('=') : entry.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join(entry.includes('=') ? '=' : ':').trim();
        if (key && value) {
          const existing = map.get(key) ?? [];
          map.set(key, [...existing, value]);
        }
      }
    }

    return map;
  }
}
