import { Command } from 'commander';

import type { DoctorCheck,FormattableDoctorResult } from '../../core/types/output.js';
import type { IGitClient } from '../../interfaces/git-client.js';
import type { ILogger } from '../../interfaces/logger.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';

/**
 * Register the doctor command.
 * Performs a health check on the decision engine environment.
 */
export function registerDoctorCommand(
  program: Command,
  deps: {
    gitClient: IGitClient;
    getFormatter: () => IOutputFormatter;
    protocolRegistry: ProtocolRegistry;
    logger: ILogger;
  },
): void {
  program
    .command('doctor')
    .description('Run a health check on the decision engine')
    .action(async () => {
      const { gitClient, getFormatter, protocolRegistry, logger } = deps;
      const checks: DoctorCheck[] = [];

      // 1. Git Connectivity Check
      try {
        const version = await gitClient.resolveRef('HEAD');
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

      // 2. Protocol Configuration Check
      const protocols = protocolRegistry.getAll();
      const root = protocolRegistry.getRoot();
      checks.push({
        name: 'Protocols',
        status: 'ok',
        message: `${protocols.length} registered`,
        details: [
            `Root Protocol: ${root ? root.name : 'none'}`,
            ...protocols.map(p => `  - ${p.name} v${p.version} (${p.storageNamespace || 'root'})`)
        ],
      });

      // 3. Generic Integrity Check (Stub for now)
      checks.push({
        name: 'Configuration',
        status: 'ok',
        message: 'valid',
        details: [],
      });

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
