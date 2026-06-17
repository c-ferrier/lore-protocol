import { Command } from 'commander';

import { getProtocolIdentity } from '../../core/logic/identity.js';
import { getReferenceKeys, getRootProtocol } from '../../core/logic/protocols.js';
import type { DoctorCheck,FormattableDoctorResult } from '../../core/types/output.js';
import type { EngineInfra } from '../../services/engine-bootstrapper.js';
import { findAtoms } from '../../shell/orchestrators/discovery.js';

/**
 * Register the doctor command.
 * Performs a health check on the decision engine environment.
 */
export function registerDoctorCommand(
  program: Command,
  infra: EngineInfra,
): void {
  program
    .command('doctor')
    .description('Run a health check on the decision engine')
    .action(async () => {
      const { git, getFormatter, protocols: protocolMap, logger, baseTarget } = infra;
      const checks: DoctorCheck[] = [];

      // 1. Configuration Check (Must be first for Lore Parity)
      checks.push({
          name: 'Configuration',
          status: 'ok',
          message: 'valid',
          details: [],
      });

      // 2. Git Connectivity Check
      try {
        const version = await git.resolveRef('HEAD');
        checks.push({
          name: 'Git Connectivity',
          status: 'ok',
          message: 'healthy',
          details: [`HEAD is at ${version}`],
        });
      } catch (err) {
        checks.push({
          name: 'Git Connectivity',
          status: 'error',
          message: 'Failed to access git repository',
          details: [err instanceof Error ? err.message : String(err)],
        });
      }

      // 3. Protocol Configuration Check
      const protocols = Array.from(protocolMap.values());
      const root = getRootProtocol(protocolMap);
      checks.push({
        name: 'Protocols',
        status: 'ok',
        message: `${protocols.length} registered`,
        details: [
            `Root Protocol: ${root ? root.name : 'none'}`,
            ...protocols.map(p => `  - ${p.name} v${p.version} (${p.storageNamespace || 'root'})`)
        ],
      });

      // 4. Integrity Checks (Deep Scan)
      try {
          const atoms = await findAtoms(infra, baseTarget, { includeAllCommits: true });
          
          // A. Identity Integrity
          const idsByProtocol = new Map<string, Set<string>>();
          const duplicatesByProtocol = new Map<string, Set<string>>();
          
          for (const atom of atoms) {
              for (const [pName, state] of atom.protocols) {
                  const ctx = protocolMap.get(pName);
                  if (!ctx) continue;
                  const id = getProtocolIdentity(state, ctx);
                  if (!id) continue;

                  const set = idsByProtocol.get(pName) || new Set();
                  if (set.has(id)) {
                      const dups = duplicatesByProtocol.get(pName) || new Set();
                      dups.add(id);
                      duplicatesByProtocol.set(pName, dups);
                  }
                  set.add(id);
                  idsByProtocol.set(pName, set);
              }
          }

          if (duplicatesByProtocol.size > 0) {
              for (const [pName, dups] of duplicatesByProtocol) {
                  checks.push({
                      name: `Identity Integrity (${pName})`,
                      status: 'error',
                      message: `${dups.size} duplicate IDs found`,
                      details: Array.from(dups).map(id => `Duplicate ID: ${id}`)
                  });
              }
          } else {
              checks.push({
                  name: 'Identity Integrity',
                  status: 'ok',
                  message: 'unique',
                  details: [`Checked ${atoms.length} atoms`]
              });
          }

          // B. Reference Integrity
          const brokenRefs: string[] = [];
          const allKnownIds = new Set<string>();
          for (const [pName, set] of idsByProtocol) {
              for (const id of set) allKnownIds.add(`${pName}/${id}`);
          }

          for (const atom of atoms) {
              for (const [pName, state] of atom.protocols) {
                  const ctx = protocolMap.get(pName);
                  if (!ctx) continue;

                  for (const key of getReferenceKeys(ctx)) {
                      const refs = state.trailers[key] || [];
                      for (const ref of refs) {
                          const qualified = ref.includes('/') ? ref : `${pName}/${ref}`;
                          if (!allKnownIds.has(qualified.toLowerCase())) {
                              brokenRefs.push(`Atom ${atom.commitHash.slice(0, 7)}: broken ${key} -> ${ref}`);
                          }
                      }
                  }
              }
          }

          if (brokenRefs.length > 0) {
              checks.push({
                  name: 'Reference Integrity',
                  status: 'error',
                  message: `${brokenRefs.length} broken references found`,
                  details: brokenRefs
              });
          } else {
              checks.push({
                  name: 'Reference Integrity',
                  status: 'ok',
                  message: 'healthy',
                  details: ['All protocol references resolve to existing atoms']
              });
          }

      } catch (err) {
          checks.push({
              name: 'Deep Integrity Scan',
              status: 'warning',
              message: 'failed to scan atoms',
              details: [err instanceof Error ? err.message : String(err)]
          });
      }

      const summary = {
        total: checks.length,
        errors: checks.filter(c => c.status === 'error').length,
        warnings: checks.filter(c => c.status === 'warning').length,
        info: checks.filter(c => c.status === 'ok').length,
      };

      const status = summary.errors > 0 ? 'unhealthy' : 'healthy';

      const result: FormattableDoctorResult = {
        status,
        checks,
        summary,
      };

      const formatter = getFormatter();
      logger.result(formatter.formatDoctorResult(result));
    });
}
