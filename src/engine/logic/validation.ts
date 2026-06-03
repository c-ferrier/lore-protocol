import type { ValidationIssue } from '../types/output.js';
import type { EngineConfig } from '../types/config.js';
import type { Trailers, ProtocolState } from '../types/domain.js';
import type { IProtocol } from '../interfaces/protocol.js';

/**
 * Basic commit message structural hygiene.
 * Pure math check on string lengths and line counts.
 */
export function evaluateHygiene(subject: string, body: string, config: EngineConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!subject.trim()) {
    issues.push({
      severity: 'error',
      rule: 'subject-required',
      message: 'Commit subject line is required',
    });
  }

  if (subject.length > config.validation.subjectMaxLength) {
    issues.push({
      severity: 'warning',
      rule: 'subject-length',
      message: `Subject exceeds ${config.validation.subjectMaxLength} characters (got ${subject.length})`,
    });
  }

  const lines = body.split('\n');
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
  protocol: IProtocol,
  state: ProtocolState,
): ValidationIssue[] {
  return protocol.validateState(state);
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
