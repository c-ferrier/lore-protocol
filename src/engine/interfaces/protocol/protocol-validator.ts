import type { ProtocolState } from '../../types/domain.js';
import type { ValidationIssue } from '../../types/output.js';

/**
 * Capability interface for validating protocol state.
 * Owns schema enforcement and individual value validation.
 */
export interface IProtocolValidator {
  /**
   * Validates a parsed protocol state against the protocol schema.
   */
  validateState(state: ProtocolState, options?: { strict?: boolean }): ValidationIssue[];

  /**
   * Validates a single trailer value against the protocol schema.
   * Handles enums, regex patterns, and cross-protocol reference format checks.
   */
  validateTrailer(key: string, value: string): { valid: boolean; message?: string; rule?: string };
}
