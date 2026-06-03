import type { EngineConfig } from '../types/config.js';
import type { AtomId } from '../types/domain.js';
import type { CommitInput } from '../types/commit.js';
import type { ValidationIssue } from '../types/output.js';
import { ProtocolError } from '../util/errors.js';
import type { ProtocolRegistry } from '../services/protocol-registry.js';
import { serializeTrailers } from './trailers.js';
import { generateId } from './identity.js';

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
    const protocol = registry.get(pName);
    
    if (!protocol) {
        throw new ProtocolError(`Unknown protocol "${pName}" in commit input`, 1);
    }

    const ns = protocol.getStorageNamespace();
    const id = (existingIds && existingIds[pName]) || generateId(protocol);

    protocols[pName] = {
      id,
      identity_key: protocol.identityKey,
      version: protocol.version,
    };

    // Add identity trailer to the appropriate Git scope
    if (ns) {
        const existing = serializedTrailers[ns] || [];
        existing.push(`${protocol.identityKey}: ${id}`);
        serializedTrailers[ns] = existing;
        if (!displayOrder.includes(ns)) displayOrder.push(ns);
    } else {
        serializedTrailers[protocol.identityKey] = [id];
        displayOrder.push(protocol.identityKey);
    }

    // Collect other authorized keys from input
    for (const [key, values] of Object.entries(pTrailers)) {
      if (key === protocol.identityKey) continue;
      
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
  for (const protocol of registry.getAll()) {
      const pName = protocol.name.toLowerCase();
      if (protocols[pName]) continue;

      const id = (existingIds && existingIds[pName]) || generateId(protocol);
      const ns = protocol.getStorageNamespace();

      protocols[pName] = {
          id,
          identity_key: protocol.identityKey,
          version: protocol.version,
      };

      if (ns) {
          const existing = serializedTrailers[ns] || [];
          existing.push(`${protocol.identityKey}: ${id}`);
          serializedTrailers[ns] = existing;
          if (!displayOrder.includes(ns)) displayOrder.push(ns);
      } else {
          serializedTrailers[protocol.identityKey] = [id];
          displayOrder.push(protocol.identityKey);
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
    const protocol = registry.get(pName);
    
    if (!protocol) {
        continue;
    }

    const ns = protocol.getStorageNamespace();
    validatedProtocols.add(protocol.name.toLowerCase());

    // A. Normalize: Expert categorizes raw map into domain state (Authorized vs Unauthorized)
    const state = protocol.normalize(pTrailers, lowerClaimed);

    // B. Validate: Expert reviews the structured state
    const bucketIssues = protocol.validateState(state);

    // C. Post-process: Filter out "missing identity" errors if the protocol provides a generator
    const protocolSlug = protocol.name.toLowerCase().replace(/-/g, '');
    const identityRule = `${protocolSlug}-id-present`;

    const filteredIssues = bucketIssues.filter(issue => {
        if (issue.rule === identityRule || (issue.rule === 'required-trailer' && issue.field === protocol.identityKey)) {
            const def = protocol.getDefinition(protocol.identityKey);
            if (def?.generator && def.generator !== 'none') return false;
        }
        return true;
    });

    issues.push(...filteredIssues.map(issue => ({
        ...issue,
        field: ns ? `${ns}:${issue.field}` : issue.field
    })));
  }

  // 2. Global Integrity: Ensure all registered protocols have their requirements met
  // (even if they were missing from the input trailers map entirely)
  for (const protocol of registry.getAll()) {
      if (validatedProtocols.has(protocol.name.toLowerCase())) continue;

      // Perform validation on an empty state to catch missing required trailers
      const emptyState = protocol.normalize({}, lowerClaimed);
      const bucketIssues = protocol.validateState(emptyState);

      // Filter out identity issues as they are handled during build()
      const protocolSlug = protocol.name.toLowerCase().replace(/-/g, '');
      const identityRule = `${protocolSlug}-id-present`;

      const filteredIssues = bucketIssues.filter(issue => {
          if (issue.rule === identityRule || (issue.rule === 'required-trailer' && issue.field === protocol.identityKey)) {
              const def = protocol.getDefinition(protocol.identityKey);
              if (def?.generator && def.generator !== 'none') return false;
          }
          return true;
      });

      const ns = protocol.getStorageNamespace();
      issues.push(...filteredIssues.map(issue => ({
          ...issue,
          field: ns ? `${ns}:${issue.field}` : issue.field
      })));
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