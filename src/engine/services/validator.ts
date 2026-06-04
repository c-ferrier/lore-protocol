import type { AtomRepository } from './atom-repository.js';
import type { EngineConfig } from '../core/types/config.js';
import type { RawCommit } from '../interfaces/git-client.js';
import type { CommitValidationResult, ValidationIssue } from '../core/types/output.js';
import type { Trailers, ProtocolState } from '../core/types/domain.js';
import type { QueryIdentity } from '../core/types/query.js';
import type { ProtocolContext } from '../core/types/protocol-definition.js';

import type { ProtocolRegistry } from './protocol-registry.js';
import { parseTrailers } from '../core/logic/trailers.js';
import { 
    evaluateHygiene, 
    evaluateTrailerHygiene, 
    validateState,
    validateTrailer
} from '../core/logic/validation.js';
import { normalizeTrailers } from '../core/logic/normalization.js';
import { getProtocolIdentity } from '../core/logic/identity.js';
import { getReferenceKeys } from '../core/logic/protocols.js';

/**
 * Validates existing git commits for protocol compliance.
 * Supports multiple protocols via the ProtocolRegistry.
 * 
 * SOLID: SRP -- focused on orchestrating validation passes (Logic + History I/O).
 */
export class Validator {
  constructor(
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
      let issues: ValidationIssue[] = [];
      let trailers: Trailers;

      try {
        trailers = parseTrailers(raw.trailers);
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

      // 1. Structural Hygiene (Generic Logic)
      issues.push(...evaluateHygiene(raw.subject, raw.body, this.config));

      // 2. Multi-Protocol Validation
      for (const ctx of protocols) {
        // Validation needs to see everything (even invalid values) to report errors
        const state = normalizeTrailers(trailers, ctx, claimedKeys);
        
        issues.push(...validateState(ctx, state, this.protocolRegistry));
        await this.validateReferenceExistence(ctx, state.trailers, issues);
      }

      // 3. Generic Trailer Hygiene (Logic)
      issues.push(...evaluateTrailerHygiene(trailers));

      // Final ID for UI parity (prefer root namespace or first protocol)
      const primary = this.protocolRegistry.getRoot() || protocols[0];
      const primaryState = primary ? normalizeTrailers(trailers, primary, claimedKeys) : null;
      
      let displayId = null;
      if (primary && primaryState) {
          displayId = getProtocolIdentity(primaryState, primary);
      }

      return {
        commit: raw.hash,
        id: displayId,
        valid: issues.filter((i) => i.severity === 'error').length === 0,
        issues,
      };
    }));
  }

  /**
   * Checks if referenced IDs actually exist in the repository history.
   * This is the only part of validation that requires I/O (AtomRepository).
   */
  private async validateReferenceExistence(
    ctx: ProtocolContext,
    trailers: Trailers,
    issues: ValidationIssue[],
  ): Promise<void> {
    const refKeys = getReferenceKeys(ctx);
    const identitiesToCheck: Array<{ key: string; identity: QueryIdentity }> = [];
    const protocolName = ctx.def.name;

    for (const key of refKeys) {
      const values = trailers[key] || [];

      for (const val of values) {
        try {
          // Check if format is valid before checking existence
          const validResult = validateTrailer(ctx, key, val, this.protocolRegistry);
          if (!validResult.valid) continue;

          // resolveIdentity is safe here because validateTrailer already passed
          const identity = this.protocolRegistry.resolveIdentity(val, protocolName);
          identitiesToCheck.push({ key, identity });
        } catch {
          // Skip if resolution fails (already handled by first pass)
        }
      }
    }

    if (identitiesToCheck.length === 0) return;

    // Batch lookup all referenced identities
    const foundAtoms = await this.atomRepository.findByIds(identitiesToCheck.map(x => x.identity));
    
    // Efficiently track which IDs were found (fully qualified)
    const foundKeys = new Set<string>();
    for (const atom of foundAtoms) {
      for (const [pName, state] of atom.protocols) {
        const targetCtx = this.protocolRegistry.get(pName);
        if (!targetCtx) continue;

        const atomId = getProtocolIdentity(state, targetCtx);
        if (atomId) foundKeys.add(`${pName.toLowerCase()}/${atomId}`);
      }
    }

    // Report missing IDs
    for (const { key, identity } of identitiesToCheck) {
      const lookupKey = `${(identity.protocol || protocolName).toLowerCase()}/${identity.id}`;
      if (!foundKeys.has(lookupKey)) {
        issues.push({
          severity: ctx.def.strict ? 'error' : 'warning',
          rule: 'reference-exists',
          field: key,
          message: `[${ctx.def.name.toLowerCase()}] Referenced id "${identity.id}"${identity.protocol ? ` in protocol "${identity.protocol}"` : ''} in ${key} was not found in history`,
        });
      }
    }
  }
}
