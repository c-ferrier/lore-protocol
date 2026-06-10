import { ProtocolError } from '../../util/errors.js';
import type { CommitInput, PreparedCommit } from '../types/commit.js';
import type { EngineConfig } from '../types/config.js';
import { type AtomId, ProtocolMap, type ProtocolState } from '../types/domain.js';
import type { ValidationIssue } from '../types/output.js';
import type { ProtocolContext } from '../types/protocol-definition.js';
import { generateId } from './identity.js';
import { normalizeTrailers } from './normalization.js';
import { getClaimedProtocolKeys } from './protocols.js';
import { serializeTrailers } from './trailers.js';
import { validateProtocolState } from './validation.js';

/**
 * Builds a full git commit message with subject, body, and trailer block.
 * Generates unique IDs for all registered protocols.
 */
export function formatCommit(
  input: CommitInput, 
  config: EngineConfig, 
  protocols: ProtocolMap<ProtocolContext>, 
  existingIds?: Record<string, AtomId>
): PreparedCommit {
  const resultProtocols = new ProtocolMap<ProtocolState>();
  const serializedTrailers: Record<string, string[]> = {};
  const displayOrder: string[] = [];

  // 1. Map logically grouped input into physical storage buckets
  for (const [pName, pTrailers] of input.trailers.entries()) {
    const ctx = protocols.get(pName);
    
    if (!ctx) {
        throw new ProtocolError(`Unknown protocol "${pName}" in commit input`, 1);
    }

    const { def } = ctx;
    const ns = def.namespace;
    const lowerPName = ctx.name;
    const id = (existingIds && (existingIds[lowerPName] || existingIds[pName])) || generateId(ctx);

    const trailers: Record<string, string[]> = {
        [def.identityKey]: [id]
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
        trailers[key] = [...values];
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

    resultProtocols.set(lowerPName, { trailers, unauthorized: {} });
  }

  // 2. Ensure all registered protocols have an identity, even if they had no input trailers
  for (const ctx of protocols.values()) {
      const lowerPName = ctx.name;
      if (resultProtocols.has(lowerPName)) continue;

      const id = (existingIds && (existingIds[lowerPName] || existingIds[ctx.def.name])) || generateId(ctx);
      const ns = ctx.storageNamespace;

      resultProtocols.set(lowerPName, { 
          trailers: { [ctx.identityKey]: [id] }, 
          unauthorized: {} 
      });

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

  const subject = input.subject;
  const body = input.body?.trim() || '';
  
  let message = subject;
  if (body) {
    message += `\n\n${body}`;
  }
  message += `\n\n${trailerBlock}`;

  return { 
      message, 
      subject,
      body,
      protocols: resultProtocols 
  };
}

/**
 * Validate a commit without writing it. 
 * Performs structural bounds checking on the formatting process.
 */
export async function validateFormatting(
  input: CommitInput, 
  config: EngineConfig, 
  protocols: ProtocolMap<ProtocolContext>
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const validatedProtocols = new Set<string>();
  const lowerClaimed = getClaimedProtocolKeys(protocols);

  // 1. Validate protocols present in the input
  for (const [pName, pTrailers] of input.trailers.entries()) {
    const ctx = protocols.get(pName);
    
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
    const bucketIssues = validateProtocolState(state, ctx.def, protocols);

    // C. Post-process: Filter out "missing identity" errors if the protocol provides a generator
    const protocolSlug = ctx.name.replace(/-/g, '');
    const identityRule = `${protocolSlug}-id-present`;

    const filteredIssues = bucketIssues.filter((issue: ValidationIssue) => {
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
  for (const ctx of protocols.values()) {
      if (validatedProtocols.has(ctx.name)) continue;

      // Perform validation on an empty state to catch missing required trailers
      const emptyState = normalizeTrailers({}, ctx, lowerClaimed);
      const bucketIssues = validateProtocolState(emptyState, ctx.def, protocols);

      // Filter out identity issues as they are handled during build()
      const protocolSlug = ctx.name.replace(/-/g, '');
      const identityRule = `${protocolSlug}-id-present`;

      const filteredIssues = bucketIssues.filter((issue: ValidationIssue) => {
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
