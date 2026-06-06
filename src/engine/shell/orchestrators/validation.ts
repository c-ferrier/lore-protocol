import { getProtocolIdentity } from '../../core/logic/identity.js';
import { normalizeTrailers } from '../../core/logic/normalization.js';
import { getReferenceKeys } from '../../core/logic/protocols.js';
import { parseTrailers } from '../../core/logic/trailers.js';
import { 
    evaluateHygiene, 
    evaluateTrailerHygiene, 
    validateProtocolState,
    validateProtocolTrailer
} from '../../core/logic/validation.js';
import type { EngineConfig } from '../../core/types/config.js';
import type { Trailers } from '../../core/types/domain.js';
import type { CommitValidationResult, ValidationIssue } from '../../core/types/output.js';
import type { ProtocolContext } from '../../core/types/protocol-definition.js';
import type { QueryIdentity } from '../../core/types/query.js';
import type { RawCommit } from '../../interfaces/git-client.js';
import type { AtomRepository } from '../../services/atom-repository.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';

/**
 * Orchestrates the validation of commits across all registered protocols.
 * UI-Agnostic: Suitable for CLI, Web Services, or CI integration.
 * 
 * DESIGN: Coordinates between Core Logic (pure math) and Shell Services (I/O).
 */
export async function validateCommits(
  rawCommits: readonly RawCommit[],
  deps: {
    atomRepository: AtomRepository;
    config: EngineConfig;
    protocolRegistry: ProtocolRegistry;
  }
): Promise<CommitValidationResult[]> {
  const { atomRepository, config, protocolRegistry } = deps;
  const protocols = protocolRegistry.getAll();
  const claimedKeys = protocolRegistry.getClaimedKeys();

  return Promise.all(rawCommits.map(async (raw) => {
    const issues: ValidationIssue[] = [];
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
    issues.push(...evaluateHygiene(raw.subject, raw.body, config));

        // 2. Multi-Protocol Validation
    const identities: Record<string, string> = {};
    for (const ctx of protocols) {
      // Validation needs to see everything (even invalid values) to report errors
      const state = normalizeTrailers(trailers, ctx, claimedKeys);
      
      // Collect identity for this protocol if valid
      const id = getProtocolIdentity(state, ctx);
      if (id) identities[ctx.name.toLowerCase()] = id;

      issues.push(...validateProtocolState(state, ctx.def, protocolRegistry));
      await validateReferenceExistence(ctx, state.trailers, issues, { atomRepository, protocolRegistry });
    }

    // 3. Generic Trailer Hygiene (Logic)
    issues.push(...evaluateTrailerHygiene(trailers));

    return {
      commit: raw.hash,
      valid: issues.filter((i) => i.severity === 'error').length === 0,
      issues,
      identities,
    };

  }));
}

/**
 * Checks if referenced IDs actually exist in the repository history.
 * This is the only part of validation that requires I/O (AtomRepository).
 */
async function validateReferenceExistence(
  ctx: ProtocolContext,
  trailers: Trailers,
  issues: ValidationIssue[],
  deps: {
    atomRepository: AtomRepository;
    protocolRegistry: ProtocolRegistry;
  }
): Promise<void> {
  const { atomRepository, protocolRegistry } = deps;
  const refKeys = getReferenceKeys(ctx);
  const identitiesToCheck: Array<{ key: string; identity: QueryIdentity }> = [];
  const protocolName = ctx.def.name;

  for (const key of refKeys) {
    const values = trailers[key] || [];

    for (const val of values) {
      try {
        // Check if format is valid before checking existence
        const validResult = validateProtocolTrailer(key, val, ctx.def, protocolRegistry);
        if (!validResult.valid) continue;

        // resolveIdentity is safe here because validateTrailer already passed
        const identity = protocolRegistry.resolveIdentity(val, protocolName);
        identitiesToCheck.push({ key, identity });
      } catch {
        // Skip if resolution fails (already handled by first pass)
      }
    }
  }

  if (identitiesToCheck.length === 0) return;

  // Batch lookup all referenced identities
  const foundAtoms = await atomRepository.findByIds(identitiesToCheck.map(x => x.identity));
  
  // Efficiently track which IDs were found (fully qualified)
  const foundKeys = new Set<string>();
  for (const atom of foundAtoms) {
    for (const [pName, state] of atom.protocols) {
      const targetCtx = protocolRegistry.get(pName);
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
