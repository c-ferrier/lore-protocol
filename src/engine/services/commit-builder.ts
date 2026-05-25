import type { TrailerParser } from './trailer-parser.js';
import type { IdGenerator } from './id-generator.js';
import type { Config } from '../types/config.js';
import type { Trailers, AtomId } from '../types/domain.js';
import type { CommitInput } from '../types/commit.js';
import type { ValidationIssue } from '../types/output.js';
import type { IProtocol } from '../interfaces/protocol.js';
import type { ProtocolRegistry } from './protocol-registry.js';

/**
 * Builds and validates git commit messages enriched with decision context.
 * Supports multiple protocols simultaneously.
 */
export class CommitBuilder {
  constructor(
    private readonly trailerParser: TrailerParser,
    private readonly idGenerator: IdGenerator,
    private readonly config: Config,
    private readonly protocolRegistry: ProtocolRegistry,
  ) {}

  /**
   * Builds a full git commit message with subject, body, and trailer block.
   * Generates unique IDs for all registered protocols.
   */
  build(input: CommitInput, existingIds?: Record<string, AtomId>): { message: string; ids: Record<string, AtomId> } {
    const ids: Record<string, AtomId> = {};
    const trailers: Record<string, string[]> = {};
    const allAuthorizedKeys: string[] = [];
    const claimedKeys = new Set<string>();

    const protocols = this.protocolRegistry.getAll();

    // 1. Process each protocol for identity and authorized keys
    for (const protocol of protocols) {
      const pName = protocol.name.toLowerCase();
      const id = (existingIds && existingIds[pName]) || this.idGenerator.generate();
      ids[pName] = id;

      const prefix = protocol.namespace ? `${protocol.namespace}/` : '';
      
      // Add identity trailer
      const identityKey = `${prefix}${protocol.identityKey}`;
      trailers[identityKey] = [id];
      allAuthorizedKeys.push(identityKey);
      claimedKeys.add(identityKey);

      // Collect other authorized keys
      for (const key of protocol.getAuthorizedKeys()) {
        if (key === protocol.identityKey) continue;
        const fullKey = `${prefix}${key}`;
        
        const values = input.trailers ? (input.trailers[fullKey] || input.trailers[key]) : undefined;
        if (values && values.length > 0) {
          trailers[fullKey] = [...values];
          allAuthorizedKeys.push(fullKey);
          claimedKeys.add(fullKey);
          claimedKeys.add(key);
        }
      }
    }

    // 2. Permissive protocols claim orphans
    for (const protocol of protocols) {
        if (protocol.permissive && input.trailers) {
            for (const [key, values] of Object.entries(input.trailers)) {
                if (claimedKeys.has(key)) continue;
                
                const matchesNamespace = protocol.namespace && key.startsWith(`${protocol.namespace}/`);
                const isRootProtocol = protocol.namespace === '';

                // Greedy match: 
                // - Namespaced protocols claim orphans in their namespace
                // - Root protocol claims ALL remaining orphans (namespaced or not) if it's permissive
                if (matchesNamespace || isRootProtocol) {
                    trailers[key] = [...values];
                    allAuthorizedKeys.push(key);
                    claimedKeys.add(key);
                }
            }
        }
    }

    const trailerBlock = this.trailerParser.serialize(trailers, allAuthorizedKeys);

    let message = input.intent;
    if (input.body && input.body.trim()) {
      message += `\n\n${input.body.trim()}`;
    }
    message += `\n\n${trailerBlock}`;

    return { message, ids };
  }

  /**
   * Performs validation on the commit input across all protocols.
   */
  validate(input: CommitInput): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!input.intent.trim()) {
      issues.push({
        severity: 'error',
        rule: 'intent-required',
        message: 'Commit intent (subject line) is required',
      });
    }

    if (input.intent.length > this.config.validation.intentMaxLength) {
      issues.push({
        severity: 'warning',
        rule: 'intent-length',
        message: `Intent exceeds ${this.config.validation.intentMaxLength} characters (got ${input.intent.length})`,
      });
    }

    for (const protocol of this.protocolRegistry.getAll()) {
      const prefix = protocol.namespace ? `${protocol.namespace}/` : '';
      
      for (const key of protocol.getAuthorizedKeys()) {
        const def = protocol.getDefinition(key);
        if (!def) continue;

        const fullKey = `${prefix}${key}`;
        const values = input.trailers ? (input.trailers[fullKey] || input.trailers[key]) : undefined;
        if (!values || values.length === 0) continue;

        if (def.validation === 'values' && def.values) {
          const allowedValues = Object.keys(def.values);
          for (const v of values) {
            if (!allowedValues.includes(v)) {
              issues.push({
                severity: 'error',
                rule: 'invalid-enum',
                field: fullKey,
                message: `[${protocol.name}] Invalid value for "${key}": "${v}". Expected one of: ${allowedValues.join(', ')}`,
              });
            }
          }
        } else if (def.validation === 'pattern' && def.pattern) {
          const regex = new RegExp(def.pattern);
          for (const v of values) {
            if (!regex.test(v)) {
              let rule = 'invalid-format';
              if (def.ui?.kind === 'reference') {
                const protocolSlug = protocol.name.toLowerCase().replace(/-/g, '');
                rule = `invalid-${protocolSlug}-id-ref`;
              }

              issues.push({
                severity: 'error',
                rule,
                field: fullKey,
                message: `[${protocol.name}] Value for "${key}" does not match pattern: ${def.pattern}`,
              });
            }
          }
        }
      }
      
      const requiredKeys = new Set(this.config.trailers.required);
      for (const key of requiredKeys) {
        if (protocol.owns(key) && !this.hasTrailer(input, key, protocol.namespace)) {
           issues.push({
            severity: this.config.validation.strict ? 'error' : 'warning',
            rule: 'required-trailer',
            field: key,
            message: `Required trailer "${key}" is missing for protocol ${protocol.name}`,
          });
        }
      }
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
    const fullKey = namespace ? `${namespace}/${key}` : key;
    return !!(input.trailers?.[fullKey] && input.trailers[fullKey].length > 0) || 
           !!(input.trailers?.[key] && input.trailers[key].length > 0);
  }

  private estimateLineCount(input: CommitInput): number {
    let count = 1;
    if (input.body) {
      count += 2;
      count += input.body.split('\n').length;
    }
    if (input.trailers) {
      count += 2;
      for (const rawValues of Object.values(input.trailers)) {
        const values = (rawValues || []) as readonly string[];
        if (values.length > 0) {
          count += values.length;
        }
      }
    }
    return count;
  }
}
