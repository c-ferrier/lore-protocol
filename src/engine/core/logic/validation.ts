import type { EngineConfig } from '../types/config.js';
import { ProtocolMap, type ProtocolState, type Trailers } from '../types/domain.js';
import type { ValidationIssue } from '../types/output.js';
import type { ProtocolContext,ProtocolDefinition } from '../types/protocol-definition.js';
import { resolveProtocolIdentity } from './protocols.js';

/**
 * Basic commit message structural hygiene.
 * Pure math check on string lengths and line counts.
 */
export function evaluateHygiene(subject: string = '', body: string = '', config: EngineConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!subject || !subject.trim()) {
    issues.push({
      severity: 'error',
      rule: 'subject-required',
      message: 'Commit subject line is required',
    });
  }

  if (subject && subject.length > config.validation.subjectMaxLength) {
    issues.push({
      severity: 'warning',
      rule: 'subject-length',
      message: `Subject exceeds ${config.validation.subjectMaxLength} characters (got ${subject.length})`,
    });
  }

  const lines = (body || '').split('\n');
  if (lines.length > config.validation.maxMessageLines) {
    issues.push({
      severity: 'warning',
      rule: 'message-length',
      message: `Commit message is very long (${lines.length} lines). Consider condensing narrative or splitting changes.`,
    });
  }

  return issues;
}

/**
 * Validate a trailer collection against a specific protocol schema.
 * Pure logic -- calls the protocol's validateState which performs schema math.
 */
export function evaluateProtocolSchema(
  protocol: ProtocolContext,
  state: ProtocolState,
  protocols?: ProtocolMap<ProtocolContext>,
): ValidationIssue[] {
  return validateProtocolState(state, protocol.def, protocols);
}

/**
 * Checks if a string matches the protocol's identity format.
 * Pure logic -- takes identity string and protocol definition.
 */
export function isValidProtocolIdentity(id: string, def: ProtocolDefinition): boolean {
  const idDef = def.trailers[def.identityKey];
  if (!idDef?.pattern) return true;
  return new RegExp(idDef.pattern).test(id);
}

/**
 * Validates a protocol state against its definition.
 * Pure logic -- no classes or internal state.
 */
export function validateProtocolState(
  state: ProtocolState,
  def: ProtocolDefinition,
  protocols?: ProtocolMap<ProtocolContext>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  
  // Sort keys by prompt order for deterministic issue reporting
  const keys = Object.keys(def.trailers).sort((a, b) => {
      const orderA = def.trailers[a]?.prompt?.order ?? 1000;
      const orderB = def.trailers[b]?.prompt?.order ?? 1000;
      return orderA - orderB;
  });

  for (const key of keys) {
    const tDef = def.trailers[key];
    const values = state.trailers[key] || [];

    if (tDef?.required && values.length === 0) {
        issues.push({
          severity: (key === def.identityKey || def.strict) ? 'error' : 'warning',
          rule: (key === def.identityKey) ? `${def.name.toLowerCase().replace(/-/g, '')}-id-present` : 'required-trailer',
          field: def.namespace !== '' && key !== def.namespace ? `${def.namespace}:${key}` : key,
          message: `[${def.name.toLowerCase()}] Required trailer missing: "${key}"`,
        });
    }

    if (tDef?.multivalue === false && values.length > 1) {
        issues.push({
          severity: 'error',
          rule: 'invalid-cardinality',
          field: key,
          message: `[${def.name.toLowerCase()}] Trailer "${key}" allows only one value (got ${values.length})`,
        });
    }

    for (const value of values) {
      const result = validateProtocolTrailer(key, value, def, protocols);
      if (!result.valid) {
        issues.push({
          severity: (key === def.identityKey || def.strict) ? 'error' : 'warning',
          rule: result.rule || 'invalid-format',
          field: key,
          message: result.message || `[${def.name.toLowerCase()}] Invalid value for "${key}": "${value}"`,
        });
      }
    }
  }

  if (!def.permissive) {
    for (const [key] of Object.entries(state.unauthorized)) {
        issues.push({
          severity: 'error',
          rule: 'unauthorized-trailer',
          field: def.namespace !== '' && key !== def.namespace ? `${def.namespace}:${key}` : key,
          message: `[${def.name.toLowerCase()}] Trailer "${key}" is not recognized by protocol schema`,
        });
    }
  }
  return issues;
}

/**
 * Validates a single trailer value.
 * Pure logic -- no classes or internal state.
 */
export function validateProtocolTrailer(
  key: string, 
  value: string, 
  def: ProtocolDefinition,
  protocols?: ProtocolMap<ProtocolContext>
): { valid: boolean; message?: string; rule?: string } {
  const tDef = def.trailers[key];
  if (!tDef) return { valid: true };

  if (tDef.validation === 'values' && tDef.values) {
    if (!Object.keys(tDef.values).includes(value)) {
      return {
        valid: false,
        rule: 'invalid-enum',
        message: `[${def.name.toLowerCase()}] Invalid value for "${key}": "${value}". Expected one of: ${Object.keys(tDef.values).join(', ')}`,
      };
    }
  }

  if (tDef.validation === 'pattern' && tDef.pattern) {
    if (!new RegExp(tDef.pattern).test(value)) {
      let rule = 'invalid-format';
      let message = `[${def.name.toLowerCase()}] Value for "${key}" does not match pattern: ${tDef.pattern}`;
      if (key === def.identityKey) {
          rule = `${def.name.toLowerCase().replace(/-/g, '')}-id-format`;
          message = `[${def.name.toLowerCase()}] ${def.identityKey} "${value}" is not a valid identifier`;
      }
      return { valid: false, rule, message };
    }
  }

  if (tDef.validation === 'reference') {
    let targetPName = def.name;
    let targetId = value;

    if (value.includes('/')) {
      const [prefix, suffix] = value.split('/', 2);
      targetPName = prefix.toLowerCase();
      targetId = suffix;
    }

    const isLocal = targetPName.toLowerCase() === def.name.toLowerCase();

    if (tDef.crossProtocol === false && !isLocal) {
      return {
        valid: false,
        rule: 'cross-protocol-prohibited',
        message: `[${def.name.toLowerCase()}] Trailer "${key}" does not allow cross-protocol references (got "${targetPName}")`,
      };
    }

    if (isLocal) {
      return isValidProtocolIdentity(targetId, def) ? { valid: true } : {
        valid: false,
        rule: 'reference-format',
        message: `[${def.name.toLowerCase()}] Invalid reference format in ${key}: "${value}".`,
      };
    }

    if (!protocols) {
      return {
        valid: false,
        rule: 'unknown-protocol-prefix',
        message: `[${def.name.toLowerCase()}] Unknown protocol prefix: "${targetPName}" (Resolver not linked)`,
      };
    }

    try {
      const identity = resolveProtocolIdentity(protocols, value, def.name);
      if (!identity) return { valid: false, rule: 'unknown-protocol-prefix' };

      const targetCtx = protocols.get(identity.protocol || def.name);
      if (targetCtx && !isValidProtocolIdentity(identity.id, targetCtx.def)) {
          return {
              valid: false,
              rule: 'invalid-reference-format',
              message: `[${def.name.toLowerCase()}] Reference "${value}" is not a valid identifier for protocol "${targetCtx.name}"`
          };
      }

      return { valid: true };
    } catch (err) {
      return {
          valid: false,
          rule: 'unknown-protocol-prefix',
          message: `[${def.name.toLowerCase()}] ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Generic trailer hygiene (unrelated to specific protocols).
 * Checks for "trailer bloat" where a key appears a suspiciously high number of times.
 */
export function evaluateTrailerHygiene(trailers: Trailers): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

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

  return issues;
}
