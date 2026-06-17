import { GLOBAL_NAMESPACE } from '../../util/constants.js';
import { ProtocolError } from '../../util/errors.js';
import { ProtocolMap } from '../models/protocol-map.js';
import type { CommitInput } from '../types/commit.js';
import type { ProtocolContext } from '../types/protocol-definition.js';
import { authorizeKey } from './ownership.js';
import { resolveProtocolKey } from './protocols.js';

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
  
  return InputMode.Stdin;
}

/**
 * Maps raw CLI flag values into a structured CommitInput.
 * Pure logic: handles slugification, casing, and namespacing math.
 */
export function parseFlagsToInput(options: CommitCommandOptions, protocols: ProtocolMap<ProtocolContext>): Partial<CommitInput> {
    const trailersMap = new ProtocolMap<Record<string, string[]>>();

    // Add custom trailers from the catch-all --trailer flag
    const catchAllEntries = parseCustomTrailers(options.trailer);
    for (const entry of catchAllEntries) {
        const { protocolName: entryProtocolName, key, values } = entry;
        const targetCtx = entryProtocolName 
            ? protocols.get(entryProtocolName) 
            : resolveProtocolKey(protocols, key);

        if (targetCtx) {
            const authorizedKey = authorizeKey(key, targetCtx);
            if (authorizedKey) {
                const pName = targetCtx.def.name.toLowerCase();
                const pMap = trailersMap.get(pName) || {};
                const existing = pMap[authorizedKey] || [];
                pMap[authorizedKey] = [...existing, ...values];
                trailersMap.set(pName, pMap);
                continue;
            }
            if (entryProtocolName) {
                throw new ProtocolError(`Unknown protocol prefix "${entryProtocolName}" in trailer "${key}"`, 1);
            }
        }

        // C. Orphan Fallback (Permissive Root)
        const root = protocols.get(GLOBAL_NAMESPACE);
        if (root?.def.permissive) {
            const pName = root.def.name.toLowerCase();
            const pMap = trailersMap.get(pName) || {};
            const existing = pMap[key] || [];
            pMap[key] = [...existing, ...values];
            trailersMap.set(pName, pMap);
        }
    }

    return {
      subject: options.subject ?? '',
      body: options.body,
      trailers: trailersMap,
    };
}

/**
 * Normalizes partial user intent by applying default empty values to produce a valid CommitInput.
 */
export function finalizeCommitInput(input: Partial<CommitInput>): CommitInput {
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
