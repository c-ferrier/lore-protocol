import type { TrailerParser } from './trailer-parser.js';
import type { AtomRepository } from './atom-repository.js';
import type { Config } from '../types/config.js';
import type { RawCommit } from '../interfaces/git-client.js';
import type { CommitValidationResult, ValidationIssue } from '../types/output.js';
import type { Trailers, AtomId } from '../types/domain.js';
import type { IProtocol } from '../interfaces/protocol.js';

/**
 * Validates existing git commits for protocol compliance.
 * 
 * SOLID: SRP -- focused purely on domain validation rules.
 */
export class Validator {
  constructor(
    private readonly trailerParser: TrailerParser,
    private readonly atomRepository: AtomRepository,
    private readonly config: Config,
    private readonly protocol: IProtocol,
  ) {}

  /**
   * Validate a set of raw commits.
   */
  async validate(rawCommits: readonly RawCommit[]): Promise<CommitValidationResult[]> {
    const results: CommitValidationResult[] = [];

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

      // 2. Schema Validation (Protocol-driven)
      this.validateSchema(trailers, issues);

      // 3. Graph Integrity (Async resolution)
      await this.validateReferenceExistence(trailers, issues);

      const identityKey = this.protocol.identityKey;
      const id = trailers[identityKey]?.[0] || null;

      results.push({
        commit: raw.hash,
        id,
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
    if (raw.subject.length > validation.intentMaxLength) {
      issues.push({
        severity: 'warning',
        rule: 'intent-length',
        field: 'intent',
        message: `Intent exceeds recommended maximum of ${validation.intentMaxLength} characters`,
      });
    }

    // Rule: Overall message length (prevents bloated decision records)
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
   * Validate a trailer collection against the protocol schema.
   */
  private validateSchema(
    trailers: Trailers,
    issues: ValidationIssue[],
  ): void {
    const protocolSlug = this.protocol.name.toLowerCase().replace(/-/g, '');
    const identityRule = `${protocolSlug}-id-present`;
    const formatRule = `${protocolSlug}-id-format`;

    for (const key of this.protocol.getAuthorizedKeys()) {
      const def = this.protocol.getDefinition(key);
      if (!def) continue;

      const values = trailers[key] || [];
      const isRequired = def.required;

      // Special Rule: Check for empty string explicitly for requiredness
      const hasValue = values.length > 0 && values.every((v: string) => v.trim().length > 0);

      if (!hasValue && isRequired) {
        issues.push({
          severity: this.config.validation.strict || key === this.protocol.identityKey ? 'error' : 'warning',
          rule: key === this.protocol.identityKey ? identityRule : 'required-trailer',
          field: key,
          message: `${key} trailer is missing`,
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
          message: `Trailer "${key}" must have exactly one value (got ${values.length})`,
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
              message: `Invalid ${key} value: "${val}". Expected one of: ${validValues.join(', ')}`,
            });
          }
        } else if (def.validation === 'pattern' && def.pattern) {
          const regex = new RegExp(def.pattern);
          if (!regex.test(val)) {
            // Map pattern failures to specific semantic rules
            let rule = 'invalid-format';
            let severity: 'error' | 'warning' = 'error';
            let message = `Value for "${key}" does not match pattern: ${def.pattern}`;

            // Context-sensitive rule mapping
            if (key === this.protocol.identityKey) {
              rule = formatRule;
              message = `${this.protocol.identityKey} "${val}" is not a valid 8-character hex string`;
            } else if (def.ui?.kind === 'reference') {
              rule = 'reference-format';
              severity = 'warning';
              message = `Invalid reference format in ${key}: "${val}". Expected 8-character hex.`;
            }

            issues.push({ severity, rule, field: key, message });
          }
        }
      }
    }

    // Check for high trailer count (cardinality hygiene)
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
   * Emits a warning for each missing reference.
   */
  private async validateReferenceExistence(
    trailers: Trailers,
    issues: ValidationIssue[],
  ): Promise<void> {
    const refKeys = this.protocol.getReferenceKeys();
    
    for (const key of refKeys) {
      const values = trailers[key] || [];
      if (values.length === 0) continue;

      for (const id of values) {
        // Only validate existence for values that look like valid IDs for this protocol
        if (!this.protocol.isValidIdentity(id)) continue;
        
        const found = await this.atomRepository.findById(id);
        if (found === null) {
          issues.push({
            severity: 'warning',
            rule: 'reference-exists',
            field: key,
            message: `Referenced ${this.protocol.name}-id "${id}" in ${key} was not found in history`,
          });
        }
      }
    }
  }
}
