import type { Command } from 'commander';

import { getFormattableDefinitions } from '../../core/logic/protocols.js';
import { getEngineVersion } from '../../core/logic/version.js';
import type { EngineConfig } from '../../core/types/config.js';
import type { FormattableConfigResult, FormattableProtocolConfig, FormattableTrailerDefinition } from '../../core/types/output.js';
import type { ILogger } from '../../interfaces/logger.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';

/**
 * Register the config command.
 * Outputs the effective configuration for the current active context.
 */
export function registerConfigCommand(
  program: Command,
  deps: {
    config: EngineConfig;
    getFormatter: () => IOutputFormatter;
    protocolRegistry: ProtocolRegistry;
    logger: ILogger;
  },
): void {
  program
    .command('config')
    .description('Show effective configuration')
    .option('--trailer-type <type>', 'Filter trailers by type (core, custom, all)', 'all')
    .option('--trailer-name <name>', 'Filter trailers by name (case-insensitive contains)')
    .option('--protocol <name>', 'Filter configuration by protocol name (case-insensitive contains)')
    .action(async (options: { trailerType: string; trailerName?: string; protocol?: string }) => {
      const { getFormatter, protocolRegistry, logger } = deps;
      
      const trailerType = options.trailerType.toLowerCase();
      const trailerFilter = options.trailerName?.toLowerCase();
      const protocolFilter = options.protocol?.toLowerCase();

      const allProtocols = protocolRegistry.getAll();
      const formattableProtocols: FormattableProtocolConfig[] = [];

      for (const p of allProtocols) {
        // 1. Protocol Name Filter (case-insensitive contains)
        if (protocolFilter && !p.name.toLowerCase().includes(protocolFilter)) {
          continue;
        }

        const allDefinitions = getFormattableDefinitions(p);
        const filteredDefinitions: Record<string, FormattableTrailerDefinition> = {};

        for (const [key, def] of Object.entries(allDefinitions)) {
          // 2. Trailer Type Filter
          if (trailerType === 'core' && !def.isCore) continue;
          if (trailerType === 'custom' && def.isCore) continue;

          // 3. Trailer Name Filter (case-insensitive contains)
          if (trailerFilter && !key.toLowerCase().includes(trailerFilter)) {
            continue;
          }

          filteredDefinitions[key] = def;
        }

        formattableProtocols.push({
          name: p.name,
          version: p.def.version,
          namespace: p.storageNamespace,
          permissive: p.def.permissive ?? true,
          trailers: filteredDefinitions,
        });
      }

      const formattable: FormattableConfigResult = {
        engineVersion: getEngineVersion(),
        protocols: formattableProtocols,
      };

      const formatter = getFormatter();
      logger.result(formatter.formatConfig(formattable));
    });
}
