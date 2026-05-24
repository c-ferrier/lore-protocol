import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { IConfigLoader } from '../interfaces/config-loader.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IProtocol } from '../interfaces/protocol.js';
import type { Atom } from '../types/domain.js';

/**
 * Result of a single doctor check.
 */
export interface DoctorCheck {
  readonly name: string;
  readonly status: 'ok' | 'warning' | 'error';
  readonly message: string;
  readonly details?: string[];
}

/**
 * Register the `lore doctor` command.
 * Performs deep structural health checks on the decision repository:
 * 1. Config file existence and parsing
 * 2. Identity key uniqueness
 * 3. Reference resolution (Supersedes, Depends-on, Related)
 * 4. Orphaned dependencies
 */
export function registerDoctorCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    configLoader: IConfigLoader;
    gitClient: IGitClient;
    protocol: IProtocol;
  },
): void {
  program
    .command('doctor')
    .description('Check the health of the decision repository')
    .action(async () => {
      const { atomRepository, configLoader, protocol } = deps;
      const checks: DoctorCheck[] = [];

      // Check 1: Config
      const configPath = await configLoader.findConfigPath(process.cwd());
      if (!configPath) {
        checks.push({
          name: 'Config file',
          status: 'error',
          message: `No ${protocol.name} configuration found. Run \`${protocol.name.toLowerCase()} init\` to create one.`,
        });
      } else {
        checks.push({
          name: 'Config file',
          status: 'ok',
          message: `Found and parsed ${configPath}`,
        });
      }

      // Load all atoms for remaining checks
      let allAtoms: Atom[];
      try {
        allAtoms = await atomRepository.findAll({ all: true });
      } catch (err) {
        console.error(`error: Failed to load atoms: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      // Check 2: Uniqueness
      checks.push(checkIdentityUniqueness(allAtoms, protocol));

      // Check 3: References
      checks.push(checkReferenceResolution(allAtoms, protocol));

      // Check 4: Orphans
      checks.push(checkOrphanedDependencies(allAtoms, protocol));

      // Output
      let totalErrors = 0;
      for (const check of checks) {
        const prefix =
          check.status === 'ok'
            ? 'OK '
            : check.status.toUpperCase().padEnd(7) + ' ';
        console.log(`${prefix} ${check.name}: ${check.message}`);
        if (check.status === 'error') totalErrors++;

        if (check.details && check.details.length > 0) {
          for (const detail of check.details) {
            console.log(`     - ${detail}`);
          }
        }
      }

      if (totalErrors > 0) {
        console.log(`\n${totalErrors} check(s) failed`);
        process.exit(1);
      } else {
        console.log('\nall checks passed');
      }
    });
}

/**
 * Check that every identity key is globally unique.
 */
function checkIdentityUniqueness(
  atoms: readonly Atom[],
  protocol: IProtocol,
): DoctorCheck {
  const idCounts = new Map<string, number>();
  const duplicates: string[] = [];

  for (const atom of atoms) {
    const state = atom.protocols.get(protocol.name.toLowerCase());
    const id = state?.trailers[protocol.identityKey]?.[0] || atom.id;
    
    if (!id) continue;
    const count = idCounts.get(id) ?? 0;
    idCounts.set(id, count + 1);
  }

  for (const [id, count] of idCounts.entries()) {
    if (count > 1) {
      duplicates.push(`${protocol.identityKey} "${id}" appears ${count} times`);
    }
  }

  if (duplicates.length > 0) {
    return {
      name: `${protocol.identityKey} uniqueness`,
      status: 'error',
      message: `${duplicates.length} duplicate ${protocol.identityKey}(s) found`,
      details: duplicates,
    };
  }

  return {
    name: `${protocol.identityKey} uniqueness`,
    status: 'ok',
    message: `All ${atoms.length} ${protocol.identityKey}s are unique`,
  };
}

/**
 * Check that all referenced IDs exist in the repository.
 */
function checkReferenceResolution(
  atoms: readonly Atom[],
  protocol: IProtocol,
): DoctorCheck {
  const protocolName = protocol.name.toLowerCase();
  
  // Build ID set based on current protocol's interpretation
  const allIds = new Set<string>();
  for (const atom of atoms) {
    const state = atom.protocols.get(protocolName);
    const id = state?.trailers[protocol.identityKey]?.[0] || atom.id;
    if (id) allIds.add(id);
  }

  const broken: string[] = [];
  const refKeys = protocol.getReferenceKeys();

  for (const atom of atoms) {
    const state = atom.protocols.get(protocolName);
    if (!state) continue;

    const id = state.trailers[protocol.identityKey]?.[0] || atom.id;

    for (const key of refKeys) {
      const refs = state.trailers[key] || [];
      for (const refId of refs) {
        if (protocol.isValidIdentity(refId) && !allIds.has(refId)) {
          broken.push(
            `${protocol.identityKey} "${refId}" referenced by ${id} (${key}) not found`,
          );
        }
      }
    }
  }

  if (broken.length > 0) {
    return {
      name: 'Reference resolution',
      status: 'warning',
      message: `${broken.length} broken reference(s) found`,
      details: broken,
    };
  }

  return {
    name: 'Reference resolution',
    status: 'ok',
    message: 'All references resolve to existing atoms',
  };
}

/**
 * Check for atoms that depend on superseded atoms (lineage drift).
 */
function checkOrphanedDependencies(
  atoms: readonly Atom[],
  protocol: IProtocol,
): DoctorCheck {
  const protocolName = protocol.name.toLowerCase();

  // Build a supersession set: atoms that are superseded
  const supersededIds = new Set<string>();
  for (const atom of atoms) {
    const state = atom.protocols.get(protocolName);
    const supersedes = state?.trailers.Supersedes || [];
    for (const supersededId of supersedes) {
      if (protocol.isValidIdentity(supersededId)) {
        supersededIds.add(supersededId);
      }
    }
  }

  const orphaned: string[] = [];
  for (const atom of atoms) {
    const state = atom.protocols.get(protocolName);
    if (!state) continue;

    const id = state.trailers[protocol.identityKey]?.[0] || atom.id;
    const dependsOn = state.trailers['Depends-on'] || [];
    
    for (const depId of dependsOn) {
      if (protocol.isValidIdentity(depId) && supersededIds.has(depId)) {
        orphaned.push(
          `Atom ${id} depends on ${depId}, which has been superseded`,
        );
      }
    }
  }

  if (orphaned.length > 0) {
    return {
      name: 'Orphaned dependencies',
      status: 'warning',
      message: `${orphaned.length} atom(s) depend on superseded atoms`,
      details: orphaned,
    };
  }

  return {
    name: 'Orphaned dependencies',
    status: 'ok',
    message: 'No orphaned dependencies found',
    details: [],
  };
}
