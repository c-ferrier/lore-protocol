import type { TrailerParser } from './trailer-parser.js';
import type { AtomRepository } from './atom-repository.js';
import type { EngineConfig } from '../types/config.js';
import type { RawCommit } from '../interfaces/git-client.js';
import type { CommitValidationResult, ValidationIssue } from '../types/output.js';
import type { Trailers } from '../types/domain.js';
import type { IProtocol } from '../interfaces/protocol.js';
import type { ProtocolRegistry } from './protocol-registry.js';

/**
 * Validates existing git commits for protocol compliance.
 * Supports multiple protocols via the ProtocolRegistry.
 * 
 * SOLID: SRP -- focused purely on domain validation rules.
 */
export class Validator {
  constructor(
    private readonly trailerParser: TrailerParser,
    private readonly atomRepository: AtomRepository,
    private readonly config: EngineConfig,
    private readonly protocolRegistry: ProtocolRegistry,
  ) {}

  /**
   * Validate a set of raw commits across all registered protocols.
   */
  async validate(rawCommits: readonly RawCommit[]): Promise<CommitValidationResult[]> {
    const results: CommitValidationResult[] = [];
    const protocols = this.protocolRegistry.getAll();

    for (const raw of rawCommits) {
      let trailers: Trailers;
      const issues: ValidationIssue[] = [];

      try {
        trailers = this.trailerParser.parse(raw.trailers);
      } catch (err) {
        issues.push({
          severity: 'error',
          rule: 'trailer-format',
          message: `Failed to parse trailers: ${err instanceof Error ? err.message : String(err)}`,
        });
        results.push({
          commit: raw.hash,
          id: null,
          valid: false,
          issues,
        });
        continue;
      }

      // 1. Structural Hygiene (Generic)
      this.validateHygiene(raw, issues);

      // 2. Multi-Protocol Validation
      const ids: Record<string, string> = {};
      for (const protocol of protocols) {
        this.validateProtocolSchema(protocol, trailers, issues);
        await this.validateReferenceExistence(protocol, trailers, issues);
        
        const id = protocol.getIdentity(trailers);
        if (id) {
          ids[protocol.name.toLowerCase()] = id;
        }
      }

      // 3. Generic Trailer Hygiene
      this.validateTrailerHygiene(trailers, issues);

      // Final ID for UI parity (prefer root namespace or first protocol)
      const primary = this.protocolRegistry.getRoot() || protocols[0];
      const displayId = primary ? primary.getIdentity(trailers) : null;

      results.push({
        commit: raw.hash,
        id: displayId,
        valid: issues.filter((i) => i.severity === 'error').length === 0,
        issues,
      });
    }

    return results;
  }

  /**
   * Check for basic git commit best practices.
   */
  private validateHygiene(raw: RawCommit, issues: ValidationIssue[]): void {
    const { validation } = this.config;

    // Rule: Subject line length
    if (raw.subject.length > validation.subjectMaxLength) {
      issues.push({
        severity: 'warning',
        rule: 'subject-length',
        field: 'subject',
        message: `Subject exceeds recommended maximum of ${validation.subjectMaxLength} characters`,
      });
    }

    // Rule: Overall message length
    const lines = (raw.subject + '\n' + raw.body).split('\n');
    if (lines.length > validation.maxMessageLines) {
      issues.push({
        severity: 'warning',
        rule: 'message-length',
        message: `Commit message is very long (${lines.length} lines). Consider condensing narrative or splitting changes.`,
      });
    }
  }

  /**
   * Validate a trailer collection against a specific protocol schema.
   */
  private validateProtocolSchema(
    protocol: IProtocol,
    trailers: Trailers,
    issues: ValidationIssue[],
  ): void {
    const protocolSlug = protocol.name.toLowerCase().replace(/-/g, '');
    const identityRule = `${protocolSlug}-id-present`;
    const formatRule = `${protocolSlug}-id-format`;

    for (const key of protocol.getAuthorizedKeys()) {
      const def = protocol.getDefinition(key);
      if (!def) continue;

      const values = trailers[key] || [];
      const isRequired = def.required;

      const hasValue = values.length > 0 && values.every((v: string) => v.trim().length > 0);

      if (!hasValue && isRequired) {
        issues.push({
          severity: this.config.validation.strict || key === protocol.identityKey ? 'error' : 'warning',
          rule: key === protocol.identityKey ? identityRule : 'required-trailer',
          field: key,
          message: `[${protocol.name}] ${key} trailer is missing`,
        });
        continue;
      }

      if (values.length === 0) continue;

      // Check Cardinality
      if (!def.multivalue && values.length > 1) {
        issues.push({
          severity: 'error',
          rule: 'invalid-cardinality',
          field: key,
          message: `[${protocol.name}] Trailer "${key}" must have exactly one value (got ${values.length})`,
        });
      }

      // Check content rules
      for (const val of values) {
        if (def.validation === 'values' && def.values) {
          const validValues = Object.keys(def.values);
          if (!validValues.includes(val)) {
            issues.push({
              severity: 'error',
              rule: 'invalid-enum',
              field: key,
              message: `[${protocol.name}] Invalid ${key} value: "${val}". Expected one of: ${validValues.join(', ')}`,
            });
          }
        } else if (def.validation === 'pattern' && def.pattern) {
          const regex = new RegExp(def.pattern);
          if (!regex.test(val)) {
            let rule = 'invalid-format';
            let severity: 'error' | 'warning' = 'error';
            let message = `[${protocol.name}] Value for "${key}" does not match pattern: ${def.pattern}`;

            if (key === protocol.identityKey) {
              rule = formatRule;
              message = `[${protocol.name}] ${protocol.identityKey} "${val}" is not a valid identifier`;
            } else if (def.ui?.kind === 'reference') {
              rule = 'reference-format';
              severity = 'warning';
              message = `[${protocol.name}] Invalid reference format in ${key}: "${val}".`;
            }

            issues.push({ severity, rule, field: key, message });
          }
        }
      }
    }
  }

  private validateTrailerHygiene(trailers: Trailers, issues: ValidationIssue[]): void {
    for (const [key, values] of Object.entries(trailers)) {
      if (values.length > 5) {
        issues.push({
          severity: 'warning',
          rule: 'trailer-count',
          field: key,
          message: `High count of "${key}" trailers (${values.length}). Consider consolidating.`,
        });
      }
    }
  }

  /**
   * Check that referenced IDs actually exist in the repository. 
   */
  private async validateReferenceExistence(
    protocol: IProtocol,
    trailers: Trailers,
    issues: ValidationIssue[],
  ): Promise<void> {
    const refKeys = protocol.getReferenceKeys();
    
    for (const key of refKeys) {
      const values = trailers[key] || [];
      if (values.length === 0) continue;

      for (const id of values) {
        if (!protocol.isValidIdentity(id)) continue;
        
        const found = await this.atomRepository.findById(id);
        if (found === null) {
          issues.push({
            severity: 'warning',
            rule: 'reference-exists',
            field: key,
            message: `[${protocol.name}] Referenced id "${id}" in ${key} was not found in history`,
          });
        }
      }
    }
  }
}
