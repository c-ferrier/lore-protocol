import { getProtocolIdentity } from '../../core/logic/identity.js';
import { normalizeTrailers } from '../../core/logic/normalization.js';
import { getClaimedProtocolKeys, getReferenceKeys, resolveProtocolIdentity } from '../../core/logic/protocols.js';
import { parseTrailers } from '../../core/logic/trailers.js';
import { 
    evaluateHygiene, 
    evaluateTrailerHygiene, 
    validateProtocolState,
    validateProtocolTrailer
} from '../../core/logic/validation.js';
import type { EngineConfig } from '../../core/types/config.js';
import { type Atom, type Trailers } from '../../core/types/domain.js';
import type { CommitValidationResult, ValidationIssue } from '../../core/types/output.js';
import type { ProtocolContext } from '../../core/types/protocol-definition.js';
import type { QueryIdentity } from '../../core/types/query.js';
import { type DiscoveryInfra,findAtomsByIds } from './discovery.js';

/**
 * Orchestrates the validation of commits across all registered protocols.
 * UI-Agnostic: Suitable for CLI, Web Services, or CI integration.
 */
export async function validateCommits(
  atoms: readonly Atom[],
  infra: DiscoveryInfra & { config: EngineConfig }
): Promise<readonly CommitValidationResult[]> {
  const { protocols, config } = infra;
  const allProtocols = Array.from(protocols.values());
  const claimedKeys = getClaimedProtocolKeys(protocols);

  return Promise.all(atoms.map(async (atom) => {
    const issues: ValidationIssue[] = [];
    const identities: Record<string, string> = {};
    let parsedTrailers: Trailers;

    try {
      parsedTrailers = parseTrailers(atom.rawTrailers);
    } catch (err) {
      issues.push({
        severity: 'error',
        rule: 'trailer-format',
        message: `Failed to parse trailers: ${err instanceof Error ? err.message : String(err)}`,
      });
      return { commit: atom.commitHash, valid: false, issues, identities: {} };
    }

    // 1. Structural Hygiene (Subject/Body rules)
    issues.push(...evaluateHygiene(atom.subject, atom.body, config));

    // 2. Comprehensive Multi-Protocol Audit
    for (const ctx of allProtocols) {
      const state = normalizeTrailers(parsedTrailers, ctx, claimedKeys);
      
      // Collect identity if the protocol claims this commit
      const id = getProtocolIdentity(state, ctx);
      if (id) identities[ctx.name.toLowerCase()] = id;

      // Validate logical state (required fields, enum values, etc.)
      issues.push(...validateProtocolState(state, ctx.def, protocols));
      
      // Validate physical references
      await validateReferenceExistence(ctx, state.trailers, issues, infra);
    }

    // 3. Global Physical Audit (Catch Orphans/Typoes)
    issues.push(...evaluateTrailerHygiene(parsedTrailers));

    return {
      commit: atom.commitHash,
      valid: issues.filter((i) => i.severity === 'error').length === 0,
      issues,
      identities,
    };
  }));
}

/**
 * Checks if referenced IDs actually exist in the repository history.
 * This is the only part of validation that requires I/O.
 */
async function validateReferenceExistence(
  ctx: ProtocolContext,
  trailers: Trailers,
  issues: ValidationIssue[],
  infra: DiscoveryInfra
): Promise<void> {
  const { protocols } = infra;
  const refKeys = getReferenceKeys(ctx);
  const identitiesToCheck: Array<{ key: string; identity: QueryIdentity }> = [];
  const protocolName = ctx.def.name;

  for (const key of refKeys) {
    const values = trailers[key] || [];

    for (const val of values) {
      try {
        // Check if format is valid before checking existence
        const validResult = validateProtocolTrailer(key, val, ctx.def, protocols);
        if (!validResult.valid) continue;

        // resolveProtocolIdentity is safe here because validateTrailer already passed
        const identity = resolveProtocolIdentity(protocols, val, protocolName);
        identitiesToCheck.push({ key, identity });
      } catch {
        // Skip if resolution fails (already handled by first pass)
      }
    }
  }

  if (identitiesToCheck.length === 0) return;

  // Batch lookup all referenced identities
  const foundAtoms = await findAtomsByIds(infra, identitiesToCheck.map(x => x.identity));
  
  // Efficiently track which IDs were found (fully qualified)
  const foundKeys = new Set<string>();
  for (const atom of foundAtoms) {
    for (const [pName, state] of atom.protocols) {
      const targetCtx = protocols.get(pName);
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
