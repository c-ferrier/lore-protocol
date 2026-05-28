import type { TrailerParser } from './trailer-parser.js';
import type { AtomRepository } from './atom-repository.js';
import type { EngineConfig } from '../types/config.js';
import type { RawCommit } from '../interfaces/git-client.js';
import type { CommitValidationResult, ValidationIssue } from '../types/output.js';
import type { Trailers, ProtocolState } from '../types/domain.js';
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
    const protocols = this.protocolRegistry.getAll();
    const claimedKeys = this.protocolRegistry.getClaimedKeys();

    return Promise.all(rawCommits.map(async (raw) => {
      const issues: ValidationIssue[] = [];
      let trailers: Trailers;

      try {
        trailers = this.trailerParser.parse(raw.trailers);
      } catch (err) {
        issues.push({
          severity: 'error',
          rule: 'trailer-format',
          message: `Failed to parse trailers: ${err instanceof Error ? err.message : String(err)}`,
        });
        return {
          commit: raw.hash,
          id: null,
          valid: false,
          issues,
        };
      }

      // 1. Structural Hygiene (Generic)
      this.validateHygiene(raw, issues);

      // 2. Multi-Protocol Validation
      for (const protocol of protocols) {
        // Validation needs to see everything (even invalid values) to report errors
        const state = protocol.parse(raw.trailers, claimedKeys, true);
        
        this.validateProtocolSchema(protocol, state, issues);
        await this.validateReferenceExistence(protocol, state.trailers, issues);
      }

      // 3. Generic Trailer Hygiene
      this.validateTrailerHygiene(trailers, issues);

      // Final ID for UI parity (prefer root namespace or first protocol)
      const primary = this.protocolRegistry.getRoot() || protocols[0];
      const primaryState = primary?.parse(raw.trailers, claimedKeys);
      const displayId = primaryState ? primary.getIdentity(primaryState.trailers) : null;

      return {
        commit: raw.hash,
        id: displayId,
        valid: issues.filter((i) => i.severity === 'error').length === 0,
        issues,
      };
    }));
  }

  /**
   * Basic commit message structural hygiene.
   */
  private validateHygiene(raw: RawCommit, issues: ValidationIssue[]): void {
    if (!raw.subject.trim()) {
      issues.push({
        severity: 'error',
        rule: 'subject-required',
        message: 'Commit subject line is required',
      });
    }

    if (raw.subject.length > this.config.validation.subjectMaxLength) {
      issues.push({
        severity: 'warning',
        rule: 'subject-length',
        message: `Subject exceeds ${this.config.validation.subjectMaxLength} characters (got ${raw.subject.length})`,
      });
    }

    const lines = raw.body.split('\n');
    if (lines.length > this.config.validation.maxMessageLines) {
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
    state: ProtocolState,
    issues: ValidationIssue[],
  ): void {
    const trailers = state.trailers;
    const protocolSlug = protocol.name.toLowerCase().replace(/-/g, '');
    const identityRule = `${protocolSlug}-id-present`;

    // 1. Check for unauthorized trailers (Typos/Schema violations)
    if (state.unauthorized) {
        for (const [key, values] of Object.entries(state.unauthorized)) {
            issues.push({
                severity: 'error',
                rule: 'unauthorized-trailer',
                field: key,
                message: `[${protocol.name}] Trailer "${key}" is not recognized by protocol schema`,
            });
        }
    }

    // 2. Schema Validation
    for (const key of protocol.getAuthorizedKeys()) {
      const def = protocol.getDefinition(key);
      if (!def) continue;

      const values = trailers[key] || [];

      // Check Required
      if (def.required && values.length === 0) {
        issues.push({
          severity: this.config.validation.strict || key === protocol.identityKey ? 'error' : 'warning',
          rule: key === protocol.identityKey ? identityRule : 'required-trailer',
          field: key,
          message: `[${protocol.name}] Required trailer "${key}" is missing`,
        });
      }

      if (values.length === 0) continue;

      // Check Cardinality
      if (!def.multivalue && values.length > 1) {
        issues.push({
          severity: 'error',
          rule: 'invalid-cardinality',
          field: key,
          message: `[${protocol.name}] Trailer "${key}" allows only one value (found ${values.length})`,
        });
      }

      // Check Values/Pattern
      for (const val of values) {
        if (def.validation === 'values' && def.values) {
          const allowed = Object.keys(def.values);
          if (!allowed.includes(val)) {
            issues.push({
              severity: 'error',
              rule: 'invalid-enum',
              field: key,
              message: `[${protocol.name}] Invalid value for "${key}": "${val}". Expected one of: ${allowed.join(', ')}`,
            });
          }
        } else if (def.validation === 'pattern' && def.pattern) {
          const regex = new RegExp(def.pattern);
          if (!regex.test(val)) {
            let rule = 'invalid-format';
            let message = `[${protocol.name}] Value for "${key}" does not match pattern: ${def.pattern}`;
            let severity: 'error' | 'warning' = 'error';

            if (key === protocol.identityKey) {
              rule = `${protocolSlug}-id-format`;
              message = `[${protocol.name}] ${protocol.identityKey} "${val}" is not a valid identifier`;
            } else if (def.ui?.kind === 'reference') {
              rule = 'reference-format';
              severity = 'warning';
              message = `[${protocol.name}] Invalid reference format in ${key}: "${val}".`;
            }

            issues.push({
              severity,
              rule,
              field: key,
              message,
            });
          }
        }
      }
    }
  }

  /**
   * Generic trailer hygiene (unrelated to specific protocols).
   */
  private validateTrailerHygiene(trailers: Trailers, issues: ValidationIssue[]): void {
    // Flag keys that appear a suspiciously high number of times
    for (const [key, values] of Object.entries(trailers)) {
      if (values.length > 5) {
        issues.push({
          severity: 'warning',
          rule: 'trailer-count',
          field: key,
          message: `High count of "${key}" trailers (${values.length}). Multiple commits or atoms might be better.`,
        });
      }
    }
  }

  /**
   * Checks if referenced IDs actually exist in the repository history.
   */
  private async validateReferenceExistence(
    protocol: IProtocol,
    trailers: Trailers,
    issues: ValidationIssue[],
  ): Promise<void> {
    const refKeys = protocol.getReferenceKeys();
    const idsToCheck: Array<{ key: string; id: string }> = [];

    for (const key of refKeys) {
      const ids = trailers[key] || [];
      for (const id of ids) {
        if (protocol.isValidIdentity(id)) {
          idsToCheck.push({ key, id });
        }
      }
    }

    if (idsToCheck.length === 0) return;

    // Batch lookup all referenced IDs
    const foundAtoms = await this.atomRepository.findByIds(idsToCheck.map(x => x.id));
    
    // Efficiently track which IDs were found
    const foundIds = new Set<string>();
    for (const atom of foundAtoms) {
      for (const state of atom.protocols.values()) {
        const atomId = state.trailers[state.identityKey]?.[0];
        if (atomId) foundIds.add(atomId);
      }
    }

    // Report missing IDs
    for (const { key, id } of idsToCheck) {
      if (!foundIds.has(id)) {
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
