import type { TrailerParser } from './trailer-parser.js';
import type { IdGenerator } from './id-generator.js';
import type { EngineConfig } from '../types/config.js';
import type { AtomId } from '../types/domain.js';
import type { CommitInput } from '../types/commit.js';
import type { ValidationIssue } from '../types/output.js';
import { ProtocolError } from '../util/errors.js';
import type { ProtocolRegistry } from './protocol-registry.js';

/**
 * Builds and validates git commit messages enriched with decision context.
 * Supports multiple protocols simultaneously using Git-native nested namespacing.
 */
export class CommitBuilder {
  constructor(
    private readonly trailerParser: TrailerParser,
    private readonly idGenerator: IdGenerator,
    private readonly config: EngineConfig,
    private readonly protocolRegistry: ProtocolRegistry,
  ) {}

  /**
   * Builds a full git commit message with subject, body, and trailer block.
   * Generates unique IDs for all registered protocols.
   */
  build(input: CommitInput, existingIds?: Record<string, AtomId>): { message: string; protocols: Record<string, any> } {
    const protocols: Record<string, any> = {};
    const serializedTrailers: Record<string, string[]> = {};
    const displayOrder: string[] = [];

    // 1. Map logically grouped input into physical storage buckets
    for (const [pName, pTrailers] of input.trailers.entries()) {
      const protocol = this.protocolRegistry.get(pName);
      
      if (!protocol) {
          throw new ProtocolError(`Unknown protocol "${pName}" in commit input`, 1);
      }

      const ns = protocol.getStorageNamespace();
      const id = (existingIds && existingIds[pName]) || this.idGenerator.generate(protocol);

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
    for (const protocol of this.protocolRegistry.getAll()) {
        const pName = protocol.name.toLowerCase();
        if (protocols[pName]) continue;

        const id = (existingIds && existingIds[pName]) || this.idGenerator.generate(protocol);
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

    const trailerBlock = this.trailerParser.serialize(serializedTrailers, displayOrder);

    let message = input.subject;
    if (input.body && input.body.trim()) {
      message += `\n\n${input.body.trim()}`;
    }
    message += `\n\n${trailerBlock}`;

    return { message, protocols };
  }

  /**
   * Performs validation on the commit input across all protocols.
   */
  validate(input: CommitInput): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // 1. Basic Commit Hygiene
    if (!input.subject.trim()) {
      issues.push({
        severity: 'error',
        rule: 'subject-required',
        message: 'Commit subject line is required',
      });
    }

    if (input.subject.length > this.config.validation.subjectMaxLength) {
      issues.push({
        severity: 'warning',
        rule: 'subject-length',
        message: `Subject exceeds ${this.config.validation.subjectMaxLength} characters (got ${input.subject.length})`,
      });
    }

    // 2. Protocol-Specific State Validation
    const lowerClaimed = new Set(Array.from(this.protocolRegistry.getClaimedKeys()).map(k => k.toLowerCase()));
    const validatedProtocols = new Set<string>();

    for (const [pName, pTrailers] of input.trailers.entries()) {
        const protocol = this.protocolRegistry.get(pName);
        
        if (!protocol) {
            issues.push({
                severity: 'warning',
                rule: 'unrecognized-protocol',
                field: pName,
                message: `Protocol "${pName}" is not recognized by the engine`,
            });
            continue;
        }

        const ns = protocol.getStorageNamespace();
        validatedProtocols.add(protocol.name.toLowerCase());

        // 1. Normalize: Expert categorizes raw map into domain state (Authorized vs Unauthorized)
        const state = protocol.normalize(pTrailers, lowerClaimed);

        // 2. Validate: Expert reviews the structured state
        const bucketIssues = protocol.validateState(state);

        // Post-process: Filter out "missing identity" errors if the protocol provides a generator
        const protocolSlug = protocol.name.toLowerCase().replace(/-/g, '');
        const identityRule = `${protocolSlug}-id-present`;

        const filteredIssues = bucketIssues.filter(issue => {
            if (issue.rule === identityRule || (issue.rule === 'required-trailer' && issue.field === protocol.identityKey)) {
                const def = protocol.getDefinition(protocol.identityKey);
                if (def?.generator && def.generator !== 'none') return false;
            }
            return true;
        });

        // Add prefix to field names for namespaced protocols using the physical namespace
        issues.push(...filteredIssues.map(issue => ({
            ...issue,
            field: ns ? `${ns}:${issue.field}` : issue.field
        })));
    }

    // 3. Global Integrity: Ensure all registered protocols have their requirements met
    // (even if they were missing from the input trailers map entirely)
    for (const protocol of this.protocolRegistry.getAll()) {
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

    const lineCount = this.estimateLineCount(input);
    if (lineCount > this.config.validation.maxMessageLines) {
      issues.push({
        severity: 'warning',
        rule: 'message-length',
        message: `Message exceeds ${this.config.validation.maxMessageLines} lines (estimated ${lineCount})`,
      });
    }

    return issues;
  }

  private hasTrailer(input: CommitInput, key: string, protocolName: string): Promise<boolean> {
    const pMap = input.trailers.get(protocolName.toLowerCase());
    if (pMap && pMap[key] && pMap[key].length > 0) return Promise.resolve(true);
    
    return Promise.resolve(false);
  }

  private estimateLineCount(input: CommitInput): number {
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
}
