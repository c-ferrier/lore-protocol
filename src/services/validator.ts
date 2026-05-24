import type { TrailerParser } from './trailer-parser.js';
import type { AtomRepository } from './atom-repository.js';
import type { LoreConfig } from '../types/config.js';
import type { RawCommit } from '../interfaces/git-client.js';
import type { CommitValidationResult, ValidationIssue } from '../types/output.js';
import type { Trailers, AtomId } from '../types/domain.js';
import type { Protocol } from './protocol.js';

/**
 * Validates existing git commits for Lore protocol compliance.
 * 
 * SOLID: SRP -- focused purely on protocol rule enforcement.
 * GRASP: Information Expert -- uses trailer definitions to validate schema.
 */
export class Validator {
  constructor(
    private readonly trailerParser: TrailerParser,
    private readonly atomRepository: AtomRepository,
    private readonly config: LoreConfig,
    private readonly protocol: Protocol,
  ) {}

  /**
   * Performs validation on a collection of raw commits.
   */
  async validate(commits: readonly RawCommit[]): Promise<CommitValidationResult[]> {
    const results: CommitValidationResult[] = [];
    for (const commit of commits) {
      results.push(await this.validateCommit(commit));
    }
    return results;
  }

  /**
   * Validate a single raw commit and collect all protocol issues.
   */
  private async validateCommit(commit: RawCommit): Promise<CommitValidationResult> {
    const issues: ValidationIssue[] = [];
    let trailers: Trailers | null = null;
    let loreId: string | null = null;

    // Rule 1: Valid trailer format (parseable)
    try {
      // Use raw parser to see everything, then validate against protocol
      trailers = this.trailerParser.parse(commit.trailers);
      loreId = trailers[this.protocol.identityKey]?.[0] || null;
    } catch {
      issues.push({
        severity: 'error',
        rule: 'trailer-format',
        message: 'Failed to parse trailer block',
      });
    }

    if (trailers) {
      // 1. Schema-driven validation (Metadata-driven)
      this.validateSchema(trailers, issues);

      // 2. Structural hygiene rules
      this.validateMessageStructure(commit, issues);
      this.validateTrailerHygiene(trailers, issues);

      // 3. Cross-atom validation (Existence of references)
      await this.validateReferenceExistence(trailers, issues);
    }

    return {
      valid: issues.filter((i) => i.severity === 'error').length === 0,
      commit: commit.hash,
      loreId,
      issues,
    };
  }

  /**
   * Validate structural properties of the commit message (lengths, line counts).
   */
  private validateMessageStructure(commit: RawCommit, issues: ValidationIssue[]): void {
    // Intent Length
    const maxIntent = this.config.validation.intentMaxLength;
    if (commit.subject.length > maxIntent) {
      issues.push({
        severity: 'warning',
        rule: 'intent-length',
        field: 'intent',
        message: `Intent exceeds recommended length of ${maxIntent} chars (got ${commit.subject.length})`,
      });
    }

    // Total Message Length
    const maxLines = this.config.validation.maxMessageLines;
    const totalLines = commit.subject.split('\n').length + (commit.body ? commit.body.split('\n').length : 0);
    if (totalLines > maxLines) {
      issues.push({
        severity: 'warning',
        rule: 'message-length',
        message: `Message exceeds recommended length of ${maxLines} lines (got ${totalLines})`,
      });
    }
  }

  /**
   * Check for high counts of specific trailers that might indicate an atom is too complex.
   */
  private validateTrailerHygiene(trailers: Trailers, issues: ValidationIssue[]): void {
    const TRAILER_HYGIENE_THRESHOLD = 5;

    for (const [key, values] of Object.entries(trailers)) {
      if (values.length > TRAILER_HYGIENE_THRESHOLD) {
        issues.push({
          severity: 'warning',
          rule: 'trailer-count',
          field: key,
          message: `High count of "${key}" trailers (${values.length}). Consider breaking this decision into smaller atoms.`,
        });
      }
    }
  }

  /**
   * Validate a trailer collection against the protocol schema.
   */
  private validateSchema(
    trailers: Trailers,
    issues: ValidationIssue[],
  ): void {
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
          rule: key === this.protocol.identityKey ? 'lore-id-present' : 'required-trailer',
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
              rule = 'lore-id-format';
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
  }

  /**
   * Check that referenced Lore-ids actually exist in the repository. 
   * Emits a warning for each missing reference.
   */
  private async validateReferenceExistence(
    trailers: Trailers,
    issues: ValidationIssue[],
  ): Promise<void> {
    const refKeys = this.protocol.getReferenceKeys();
    for (const key of refKeys) {
      const values = trailers[key];
      if (!values) continue;

      for (const id of values) {
        // Only validate existence for values that look like Lore-ids
        if (!this.protocol.isValidIdentity(id)) continue;
        
        const found = await this.atomRepository.findByLoreId(id);
        if (found === null) {
          issues.push({
            severity: 'warning',
            rule: 'reference-exists',
            field: key,
            message: `Referenced atom "${id}" in ${key} not found in repository`,
          });
        }
      }
    }
  }
}
