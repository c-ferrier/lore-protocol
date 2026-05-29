import type { IProtocolValidator } from '../../interfaces/protocol/protocol-validator.ts';
import type { ProtocolState } from '../../types/domain.js';
import type { ValidationIssue } from '../../types/output.js';
import type { IProtocol } from '../../interfaces/protocol.js';
import type { ProtocolRegistry } from '../protocol-registry.js';
import { escapeRegex } from '../../util/regex.js';

/**
 * Implementation of the Protocol Validator capability.
 * Owns schema enforcement and individual value validation.
 */
export class ProtocolValidator implements IProtocolValidator {
  private registry?: ProtocolRegistry;

  constructor(private readonly protocol: IProtocol) {}

  setRegistry(registry: ProtocolRegistry): void {
    this.registry = registry;
  }

  validateState(state: ProtocolState, options?: { strict?: boolean }): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const authorizedKeys = this.protocol.getAuthorizedKeys();
    
    // Policy comes from the Expert, but can be overridden by explicit options
    const isStrict = options?.strict !== undefined ? options.strict : this.protocol.strict;
    
    const protocolSlug = this.protocol.name.toLowerCase().replace(/-/g, '');
    const identityRule = `${protocolSlug}-id-present`;

    // Map input trailers to lowercase for case-insensitive lookup
    const inputMap = new Map<string, { key: string; values: readonly string[] }>();
    for (const [k, v] of Object.entries(state.trailers)) {
        inputMap.set(k.toLowerCase(), { key: k, values: v });
    }

    // 1. Schema Validation (Authorized Keys)
    for (const key of authorizedKeys) {
      const def = this.protocol.getDefinition(key)!;
      const entry = inputMap.get(key.toLowerCase());
      const values = entry?.values || [];

      // A. Check Required
      if (def.required && values.length === 0) {
        const severity = (isStrict || key === this.protocol.identityKey) ? 'error' : 'warning';
        const rule = key === this.protocol.identityKey ? identityRule : 'required-trailer';
        const message = key === this.protocol.identityKey 
            ? `[${this.protocol.name}] ${key} trailer is missing`
            : `[${this.protocol.name}] Required trailer missing: "${key}"`;

        issues.push({
          severity,
          rule,
          field: key,
          message,
        });
        continue;
      }

      // B. Check Cardinality (Multivalue)
      if (!def.multivalue && values.length > 1) {
        issues.push({
          severity: 'error',
          rule: 'invalid-cardinality',
          field: key,
          message: `[${this.protocol.name}] Trailer "${key}" allows only one value (found ${values.length})`,
        });
      }

      // C. Check Individual Values
      for (const value of values) {
        const result = this.validateTrailer(key, value);
        if (!result.valid) {
          let severity: 'error' | 'warning' = 'error';
          if (result.rule === 'reference-format') {
             severity = isStrict ? 'error' : 'warning';
          }
          issues.push({
            severity,
            rule: result.rule || 'invalid-format',
            field: key,
            message: result.message || `[${this.protocol.name}] Invalid value for "${key}": "${value}"`,
          });
        }
      }
    }

    // 2. Check for unauthorized keys
    if (!this.protocol.permissive) {
      for (const [key, values] of Object.entries(state.unauthorized)) {
          issues.push({
            severity: 'error',
            rule: 'unauthorized-trailer',
            field: key,
            message: `[${this.protocol.name}] Trailer "${key}" is not recognized by protocol schema`,
          });
      }
    }

    return issues;
  }

  validateTrailer(key: string, value: string): { valid: boolean; message?: string; rule?: string } {
    const def = this.protocol.getDefinition(key);
    if (!def) {
      // If not defined and protocol is permissive, it's valid as a generic string
      return { valid: true };
    }

    // 1. Enum Validation
    if (def.validation === 'values' && def.values) {
      const allowed = Object.keys(def.values);
      if (!allowed.includes(value)) {
        return {
          valid: false,
          rule: 'invalid-enum',
          message: `[${this.protocol.name}] Invalid value for "${key}": "${value}". Expected one of: ${allowed.join(', ')}`,
        };
      }
    }

    // 2. Pattern Validation
    if (def.validation === 'pattern' && def.pattern) {
      const regex = new RegExp(def.pattern);
      if (!regex.test(value)) {
        let rule = 'invalid-format';
        let message = `[${this.protocol.name}] Value for "${key}" does not match pattern: ${def.pattern}`;
        
        // Identity special case
        if (key === this.protocol.identityKey) {
            rule = `${this.protocol.name.toLowerCase().replace(/-/g, '')}-id-format`;
            message = `[${this.protocol.name}] ${this.protocol.identityKey} "${value}" is not a valid identifier`;
        }

        return { valid: false, rule, message };
      }
    }

    // 3. Reference Validation (The "Mask" Check)
    if (def.validation === 'reference') {
      let targetPName = this.protocol.name.toLowerCase();
      let targetId = value;

      if (value.includes('/')) {
        const [prefix, suffix] = value.split('/', 2);
        targetPName = prefix.toLowerCase();
        targetId = suffix;
      }

      const isLocal = targetPName === this.protocol.name.toLowerCase();

      // 1. Boundary Enforcement (crossProtocol: false)
      if (def.crossProtocol === false && !isLocal) {
        return {
          valid: false,
          rule: 'cross-protocol-prohibited',
          message: `[${this.protocol.name}] Trailer "${key}" does not allow cross-protocol references (got "${targetPName}")`,
        };
      }

      // 2. Format Validation (Local)
      // If it's local (either no prefix or matches our own name), we validate it internally
      if (isLocal) {
        if (!this.protocol.isValidIdentity(targetId)) {
          return {
            valid: false,
            rule: 'reference-format',
            message: `[${this.protocol.name}] Invalid reference format in ${key}: "${value}".`,
          };
        }
        return { valid: true };
      }

      // 3. Format Validation (Cross-Protocol)
      // If we got here, it's NOT local. We require a registry to verify the neighbor.
      if (!this.registry) {
        return {
          valid: false,
          rule: 'unknown-protocol-prefix',
          message: `[${this.protocol.name}] Unknown protocol prefix: "${targetPName}" (Registry not linked)`,
        };
      }

      try {
        const identity = this.registry.resolveIdentity(value, this.protocol.name.toLowerCase());
        const targetProtocol = this.registry.get(identity.protocol || targetPName);
        
        if (targetProtocol && !targetProtocol.isValidIdentity(identity.id)) {
            return {
                valid: false,
                rule: 'invalid-reference-format',
                message: `[${this.protocol.name}] Reference "${value}" is not a valid identifier for protocol "${targetProtocol.name}"`,
            };
        }
      } catch (err) {
        return {
            valid: false,
            rule: 'unknown-protocol-prefix',
            message: `[${this.protocol.name}] ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    return { valid: true };
  }
}
