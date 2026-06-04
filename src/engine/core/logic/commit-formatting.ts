import type { EngineConfig } from '../types/config.js';
import type { AtomId, ProtocolState } from '../types/domain.js';
import type { CommitInput } from '../types/commit.js';
import type { ValidationIssue } from '../types/output.js';
import { ProtocolError } from '../../util/errors.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';
import { serializeTrailers } from './trailers.js';
import { generateId } from './identity.js';
import { normalizeTrailers } from './normalization.js';

/**
 * Builds a full git commit message with subject, body, and trailer block.
 * Generates unique IDs for all registered protocols.
 */
export function formatCommit(
  input: CommitInput, 
  config: EngineConfig, 
  registry: ProtocolRegistry, 
  existingIds?: Record<string, AtomId>
): { message: string; protocols: Record<string, any> } {
  const protocols: Record<string, any> = {};
  const serializedTrailers: Record<string, string[]> = {};
  const displayOrder: string[] = [];

  // 1. Map logically grouped input into physical storage buckets
  for (const [pName, pTrailers] of input.trailers.entries()) {
    const ctx = registry.get(pName);
    
    if (!ctx) {
        throw new ProtocolError(`Unknown protocol "${pName}" in commit input`, 1);
    }

    const { def } = ctx;
    const ns = def.namespace;
    const lowerPName = ctx.name;
    const id = (existingIds && (existingIds[lowerPName] || existingIds[pName])) || generateId(ctx);

    protocols[lowerPName] = {
      id,
      identity_key: def.identityKey,
      version: def.version,
    };

    // Add identity trailer to the appropriate Git scope
    if (ns) {
        const existing = serializedTrailers[ns] || [];
        existing.push(`${def.identityKey}: ${id}`);
        serializedTrailers[ns] = existing;
        if (!displayOrder.includes(ns)) displayOrder.push(ns);
    } else {
        serializedTrailers[def.identityKey] = [id];
        displayOrder.push(def.identityKey);
    }

    // Collect other authorized keys from input
    for (const [key, values] of Object.entries(pTrailers)) {
      if (key === def.identityKey) continue;
      
      if (values && values.length > 0) {
        if (ns) {
          const existing = serializedTrailers[ns] || [];
          for (const v of values) {
            existing.push(`${key}: ${v}`);
          }
          serializedTrailers[ns] = existing;
          if (!displayOrder.includes(ns)) displayOrder.push(ns);
        } else {
          serializedTrailers[key] = [...values];
          displayOrder.push(key);
        }
      }
    }
  }

  // 2. Ensure all registered protocols have an identity, even if they had no input trailers
  for (const ctx of registry.getAll()) {
      const lowerPName = ctx.name;
      if (protocols[lowerPName]) continue;

      const id = (existingIds && (existingIds[lowerPName] || existingIds[ctx.def.name])) || generateId(ctx);
      const ns = ctx.storageNamespace;

      protocols[lowerPName] = {
          id,
          identity_key: ctx.identityKey,
          version: ctx.version,
      };

      if (ns) {
          const existing = serializedTrailers[ns] || [];
          existing.push(`${ctx.identityKey}: ${id}`);
          serializedTrailers[ns] = existing;
          if (!displayOrder.includes(ns)) displayOrder.push(ns);
      } else {
          serializedTrailers[ctx.identityKey] = [id];
          displayOrder.push(ctx.identityKey);
      }
  }

  const trailerBlock = serializeTrailers(serializedTrailers, displayOrder);

  let message = input.subject;
  if (input.body && input.body.trim()) {
    message += `\n\n${input.body.trim()}`;
  }
  message += `\n\n${trailerBlock}`;

  return { message, protocols };
}

/**
 * Validate a commit without writing it. 
 * Performs structural bounds checking on the formatting process.
 */
export async function validateFormatting(
  input: CommitInput, 
  config: EngineConfig, 
  registry: ProtocolRegistry
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const validatedProtocols = new Set<string>();
  const lowerClaimed = registry.getClaimedKeys();

  // 1. Validate protocols present in the input
  for (const [pName, pTrailers] of input.trailers.entries()) {
    const ctx = registry.get(pName);
    
    if (!ctx) {
        continue;
    }

    const ns = ctx.storageNamespace;
    validatedProtocols.add(ctx.name);

    // A. Normalize: Expert categorizes raw map into domain state (Authorized vs Unauthorized)
    let rawMapForNormalize: Record<string, string[]>;
    if (ns) {
        // Namespaced protocols expect their trailers inside a bucket matching their namespace
        rawMapForNormalize = {
            [ns]: Object.entries(pTrailers).flatMap(([k, vals]) => 
                (vals || []).map(v => `${k}: ${v}`)
            )
        };
    } else {
        // Root protocol expects flat trailers
        rawMapForNormalize = Object.fromEntries(
            Object.entries(pTrailers).map(([k, vals]) => [k, [...vals]])
        );
    }
    
    const state = normalizeTrailers(rawMapForNormalize, ctx, lowerClaimed);

    // B. Validate: Expert reviews the structured state
    const bucketIssues = ctx.validateState(state, registry);

    // C. Post-process: Filter out "missing identity" errors if the protocol provides a generator
    const protocolSlug = ctx.name.replace(/-/g, '');
    const identityRule = `${protocolSlug}-id-present`;

    const filteredIssues = bucketIssues.filter((issue: any) => {
        if (issue.rule === identityRule || (issue.rule === 'required-trailer' && issue.field === ctx.identityKey)) {
            const def = ctx.trailers.get(ctx.identityKey);
            if (def?.generator && def.generator !== 'none') return false;
        }
        return true;
    });

    issues.push(...filteredIssues);
  }

  // 2. Global Integrity: Ensure all registered protocols have their requirements met
  // (even if they were missing from the input trailers map entirely)
  for (const ctx of registry.getAll()) {
      if (validatedProtocols.has(ctx.name)) continue;

      // Perform validation on an empty state to catch missing required trailers
      const emptyState = normalizeTrailers({}, ctx, lowerClaimed);
      const bucketIssues = ctx.validateState(emptyState, registry);

      // Filter out identity issues as they are handled during build()
      const protocolSlug = ctx.name.replace(/-/g, '');
      const identityRule = `${protocolSlug}-id-present`;

      const filteredIssues = bucketIssues.filter((issue: any) => {
          if (issue.rule === identityRule || (issue.rule === 'required-trailer' && issue.field === ctx.identityKey)) {
              const def = ctx.trailers.get(ctx.identityKey);
              if (def?.generator && def.generator !== 'none') return false;
          }
          return true;
      });

      issues.push(...filteredIssues);
  }

  const lineCount = estimateLineCount(input);
  if (lineCount > config.validation.maxMessageLines) {
    issues.push({
      severity: 'warning',
      rule: 'message-length',
      message: `Message exceeds ${config.validation.maxMessageLines} lines (estimated ${lineCount})`,
    });
  }

  return issues;
}

function estimateLineCount(input: CommitInput): number {
  let count = 1;
  if (input.body) {
    count += 2;
    count += input.body.split('\n').length;
  }
  
  for (const pMap of input.trailers.values()) {
    for (const values of Object.values(pMap)) {
      if (values && values.length > 0) {
        count += values.length;
      }
    }
  }
  
  // Add separator space for trailers
  if (input.trailers.size > 0) count += 2;

  return count;
}
