import type { CommitInput } from '../types/commit.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';
import type { EngineConfig } from '../types/config.js';
import { ProtocolMap } from '../models/protocol-map.js';
import { slugify, camelCase } from '../../util/string.js';
import { ProtocolError } from '../../util/errors.js';

/**
 * The modes of commit input resolution, ordered by priority.
 */
export enum InputMode {
  Interactive = 'interactive',
  File = 'file',
  Flags = 'flags',
  Stdin = 'stdin',
}

export interface CommitCommandOptions {
  readonly amend?: boolean;
  readonly edit?: boolean;
  readonly file?: string;
  readonly interactive?: boolean;
  readonly subject?: string;
  readonly body?: string;
  readonly trailer?: string[];
  /** Dynamic flags from definitions (e.g. confidence, scope-risk) */
  readonly [key: string]: unknown;
}

/**
 * Determine the input mode based on option priority.
 * Pure logic: determines source without performing I/O.
 */
export function selectInputMode(options: CommitCommandOptions): InputMode {
  if (options.interactive) {
    return InputMode.Interactive;
  }
  if (options.file) {
    return InputMode.File;
  }
  
  // Check if the subject line or any trailer flag was provided
  const baseFlags = ['amend', 'edit', 'subject', 'body', 'file', 'trailer', 'interactive', 'json', 'format', 'color', 'context', 'cache', 'updateNotifier'];
  const extraKeys = Object.keys(options).filter(k => !baseFlags.includes(k) && options[k] !== undefined);
  const hasFlags = !!options.subject || (options.trailer && options.trailer.length > 0) || extraKeys.length > 0;

  if (hasFlags) {
    return InputMode.Flags;
  }
  
  // Note: Stdin vs Interactive check still requires TTY check in the service shell.
  return InputMode.Stdin;
}

/**
 * Maps raw CLI flag values into a structured CommitInput.
 * Pure logic: handles slugification, casing, and namespacing math.
 */
export function parseFlagsToInput(options: CommitCommandOptions, registry: ProtocolRegistry): Partial<CommitInput> {
    const trailersMap = new ProtocolMap<Record<string, string[]>>();
    const protocols = registry.getAll();

    // 1. Dynamically map all authorized trailers from registered flags
    for (const protocol of protocols) {
        const authorizedKeys = protocol.getAuthorizedKeys();
        const ns = protocol.storageNamespace;
        const protocolName = protocol.name;

        for (const key of authorizedKeys) {
            if (key === protocol.identityKey) continue;

            const def = protocol.getDefinition(key);
            if (!def) continue;

            const shortFlag = def.cli?.flag || slugify(key);
            const fullFlag = ns ? `${slugify(ns)}:${shortFlag}` : shortFlag;
            
            const camelShort = camelCase(shortFlag);
            const camelFull = camelCase(fullFlag);
            
            const flagValue = (options as Record<string, unknown>)[camelFull] ?? 
                             (options as Record<string, unknown>)[fullFlag] ??
                             (options as Record<string, unknown>)[camelShort] ?? 
                             (options as Record<string, unknown>)[shortFlag];

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
    const catchAllEntries = parseCustomTrailers(options.trailer);
    for (const entry of catchAllEntries) {
        const { protocolName: entryProtocolName, key, values } = entry;
        let targetProtocol = entryProtocolName 
            ? registry.get(entryProtocolName) 
            : registry.resolveKey(key);

        if (targetProtocol) {
            const authorizedKey = targetProtocol.authorize(key);
            if (authorizedKey) {
                const pName = targetProtocol.name;
                const pMap = trailersMap.get(pName) ?? {};
                const existing = pMap[authorizedKey] || [];
                pMap[authorizedKey] = [...existing, ...values];
                trailersMap.set(pName, pMap);
                continue;
            }
            if (entryProtocolName && !targetProtocol) {
                throw new ProtocolError(`Unknown protocol prefix "${entryProtocolName}" in trailer "${key}"`, 1);
            }
        }

        // C. Orphan Fallback (Permissive Root)
        const rootProtocol = registry.getRoot();
        if (rootProtocol?.permissive) {
            const pName = rootProtocol.name;
            const pMap = trailersMap.get(pName) ?? {};
            const existing = pMap[key] || [];
            pMap[key] = [...existing, ...values];
            trailersMap.set(pName, pMap);
        }
    }

    return {
      subject: options.subject ?? '',
      body: options.body,
      trailers: trailersMap as CommitInput['trailers'],
    };
}

/**
 * Merges partial user intent with system defaults to produce a valid CommitInput.
 */
export function finalizeCommitInput(input: Partial<CommitInput>, config: EngineConfig): CommitInput {
    return {
        subject: input.subject ?? '',
        body: input.body ?? '',
        trailers: input.trailers || new ProtocolMap()
    };
}

/**
 * Helper: Parses multiple --trailer Key=Value or Protocol/Key=Value flags.
 */
function parseCustomTrailers(raw?: string[]): { protocolName: string | null, key: string, values: string[] }[] {
  const results: { protocolName: string | null, key: string, values: string[] }[] = [];
  if (!raw) return results;

  for (const entry of raw) {
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
