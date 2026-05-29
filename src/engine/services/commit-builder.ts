import type { TrailerParser } from './trailer-parser.js';
import type { IdGenerator } from './id-generator.js';
import type { EngineConfig } from '../types/config.js';
import type { AtomId, ProtocolState } from '../types/domain.js';
import type { CommitInput } from '../types/commit.js';
import type { ValidationIssue } from '../types/output.js';
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

    const registeredProtocols = this.protocolRegistry.getAll();

    // 1. Process each protocol for identity and authorized keys
    for (const protocol of registeredProtocols) {
      const pName = protocol.name.toLowerCase();
      const ns = protocol.namespace;
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
      const nsInput = input.trailers[ns] || {};
      for (const key of protocol.getAuthorizedKeys()) {
        if (key === protocol.identityKey) continue;
        
        const values = nsInput[key];
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

    // 2. Handle Permissive orphans in all scopes
    for (const [ns, nsMap] of Object.entries(input.trailers)) {
        const protocol = this.protocolRegistry.getAll().find(p => p.namespace.toLowerCase() === ns.toLowerCase());
        if (!protocol?.permissive) continue;

        const authorized = new Set(protocol.getAuthorizedKeys().map(k => k.toLowerCase()));
        
        for (const [key, values] of Object.entries(nsMap)) {
            const lowerKey = key.toLowerCase();
            if (authorized.has(lowerKey) || lowerKey === protocol.identityKey.toLowerCase()) continue;
            
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
    for (const [ns, nsMap] of Object.entries(input.trailers)) {
        const protocol = this.protocolRegistry.getAll().find(p => p.namespace.toLowerCase() === ns.toLowerCase());
        
        if (!protocol) {
            issues.push({
                severity: 'warning',
                rule: 'unrecognized-namespace',
                field: ns,
                message: `Namespace "${ns}" is not recognized by any registered protocol`,
            });
            continue;
        }

        // 1. Normalize: Expert categorizes raw map into domain state (Authorized vs Unauthorized)
        const state = protocol.normalize(nsMap);

        // 2. Validate: Expert reviews the structured state
        const bucketIssues = protocol.validateState(state);

        // Post-process: Filter out "missing identity" errors if the protocol provides a generator
        // (because the builder will generate it automatically in the build() phase).
        const protocolSlug = protocol.name.toLowerCase().replace(/-/g, '');
        const identityRule = `${protocolSlug}-id-present`;

        const filteredIssues = bucketIssues.filter(issue => {
            if (issue.rule === identityRule || (issue.rule === 'required-trailer' && issue.field === protocol.identityKey)) {
                const def = protocol.getDefinition(protocol.identityKey);
                if (def?.generator && def.generator !== 'none') return false;
            }
            return true;
        });

        // Add prefix to field names for namespaced protocols
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

  private hasTrailer(input: CommitInput, key: string, namespace: string): boolean {
    const nsMap = input.trailers[namespace];
    if (nsMap && nsMap[key] && nsMap[key].length > 0) return true;
    
    // Fallback for root-namespace trailers
    const rootMap = input.trailers[''];
    return !!(rootMap && rootMap[key] && rootMap[key].length > 0);
  }

  private estimateLineCount(input: CommitInput): number {
    let count = 1;
    if (input.body) {
      count += 2;
      count += input.body.split('\n').length;
    }
    
    for (const nsMap of Object.values(input.trailers)) {
      for (const values of Object.values(nsMap)) {
        if (values && values.length > 0) {
          count += values.length;
        }
      }
    }
    
    // Add separator space for trailers
    if (Object.keys(input.trailers).length > 0) count += 2;

    return count;
  }
}
