import type { Command } from 'commander';
import type { IGitClient } from '../../interfaces/git-client.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { EngineConfig } from '../../core/types/config.js';
import type { AtomRepository } from '../../services/atom-repository.js';
import type { FormattableDoctorResult } from '../../core/types/output.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';
import type { ILogger } from '../../interfaces/logger.js';
import { getGitLogArgs } from '../../core/logic/query-targets.js';
import { getProtocolIdentity } from '../../core/logic/identity.js';
import { normalizeTrailers } from '../../core/logic/normalization.js';
import { getReferenceKeys } from '../../core/logic/protocols.js';

/**
 * Register the doctor command.
 * Performs deep health checks on the repository state.
 */
export function registerDoctorCommand(
  program: Command,
  deps: {
    gitClient: IGitClient;
    atomRepository: AtomRepository;
    protocolRegistry: ProtocolRegistry;
    getFormatter: () => IOutputFormatter;
    config: EngineConfig;
    logger: ILogger;
  },
): void {
  program
    .command('doctor')
    .description('Health check: broken refs, config issues')
    .action(async () => {
      const { gitClient, atomRepository, protocolRegistry, getFormatter, logger } = deps;
      
      const checks: Array<{ name: string; status: 'ok' | 'error' | 'warning'; message: string; details: string[] }> = [];

      // 1. Git Connectivity
      try {
        const root = await gitClient.getRepoRoot();
        checks.push({
          name: 'Git Connectivity',
          status: 'ok',
          message: `Repository root: ${root}`,
          details: [],
        });
      } catch (err) {
        checks.push({
          name: 'Git Connectivity',
          status: 'error',
          message: 'Not in a git repository or git not found',
          details: [err instanceof Error ? err.message : String(err)],
        });
      }

      // 2. Configuration & Protocols
      const protocols = protocolRegistry.getAll();
      if (protocols.length === 0) {
        checks.push({
          name: 'Configuration',
          status: 'warning',
          message: 'No protocols registered',
          details: ['The engine is running in agnostic mode with no schema enforcement.'],
        });
      } else {
        checks.push({
          name: 'Configuration',
          status: 'ok',
          message: `${protocols.length} protocol(s) active: ${protocols.map(p => p.name).join(', ')}`,
          details: protocols.map(p => `  - ${p.name} v${p.version} (${p.storageNamespace || 'root'})`),
        });
      }

      // 3. Scan for "Broken Links" and "Duplicates"
      try {
        const atoms = await atomRepository.find(undefined, { maxCommits: 500 });
        
        // 3a. Identity Integrity (Uniqueness)
        const idCounts = new Map<string, string[]>(); // qualifiedId -> commitHashes[]
        for (const atom of atoms) {
            for (const [pName, state] of atom.protocols) {
                const p = protocolRegistry.get(pName);
                if (!p) continue;
                const id = p.getIdentity(state);
                if (id) {
                    const fullId = `${pName.toLowerCase()}/${id}`;
                    const existing = idCounts.get(fullId) || [];
                    idCounts.set(fullId, [...existing, atom.commitHash]);
                }
            }
        }

        const duplicates = Array.from(idCounts.entries()).filter(([_, hashes]) => hashes.length > 1);
        if (duplicates.length > 0) {
            checks.push({
              name: 'Identity Integrity',
              status: 'error',
              message: `Found ${duplicates.length} duplicate identities`,
              details: duplicates.map(([id, hashes]) => `  - ${id} is used in commits: ${hashes.join(', ')}`),
            });
        } else {
            const totalIds = Array.from(idCounts.keys()).length;
            checks.push({
              name: 'Identity Integrity',
              status: 'ok',
              message: `All ${totalIds} identities are unique`,
              details: [],
            });
        }

        // 3b. Reference Integrity (Broken Links)
        const knownIds = new Set(idCounts.keys());
        const brokenRefs: Array<{ commit: string, key: string, id: string, pName: string }> = [];

        // We need to re-parse raw trailers to find references because Atoms only store normalized data
        const logPatterns = protocolRegistry.getDiscoveryPatterns();
        const rawCommits = await gitClient.query({
            regexPatterns: [logPatterns],
            maxCommits: 500
        });

        for (const raw of rawCommits) {
          const detected = protocolRegistry.detect(raw.trailers);
          for (const p of detected) {
            const parsed = p.normalize(Object.fromEntries(
                raw.trailers.split('\n').map(l => {
                  const [k, ...v] = l.split(':');
                  return [k.trim(), [v.join(':').trim()]];
                })
            ));

            for (const key of p.getReferenceKeys()) {
                const refs = parsed.trailers[key] || [];
                for (const val of refs) {
                    try {
                        const identity = protocolRegistry.resolveIdentity(val, p.name);
                        const lookupKey = `${identity.protocol.toLowerCase()}/${identity.id}`;
                        if (!knownIds.has(lookupKey)) {
                            brokenRefs.push({ commit: raw.hash, key, id: val, pName: p.name });
                        }
                    } catch { /* skip */ }
                }
            }
          }
        }

        if (brokenRefs.length > 0) {
            checks.push({
              name: 'Reference Integrity',
              status: 'error',
              message: `Found ${brokenRefs.length} broken cross-references`,
              details: brokenRefs.map(r => `  - ${r.commit.slice(0, 8)}: "${r.id}" (referenced in ${r.key}) was not found`),
            });
        } else {
            checks.push({
              name: 'Reference Integrity',
              status: 'ok',
              message: 'All cross-protocol references are resolvable',
              details: [],
            });
        }

      } catch (err) {
        checks.push({
          name: 'History Integrity',
          status: 'error',
          message: 'Failed to complete history scan',
          details: [err instanceof Error ? err.message : String(err)],
        });
      }

      const formattable: FormattableDoctorResult = {
        status: checks.some(c => c.status === 'error') ? 'unhealthy' : 'healthy',
        checks,
        summary: {
          total: checks.length,
          errors: checks.filter(c => c.status === 'error').length,
          warnings: checks.filter(c => c.status === 'warning').length,
          info: checks.filter(c => c.status === 'ok').length,
        },
      };

      const formatter = getFormatter();
      logger.result(formatter.formatDoctorResult(formattable));
    });
}
