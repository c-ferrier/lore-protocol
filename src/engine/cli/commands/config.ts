import type { Command } from 'commander';

import { getFormattableDefinitions } from '../../core/logic/protocols.js';
import type { EngineConfig } from '../../core/types/config.js';
import type { FormattableConfigResult, FormattableTrailerDefinition } from '../../core/types/output.js';
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
    .option('--core', 'Show only core trailer definitions')
    .option('--custom', 'Show only custom trailer definitions')
    .action(async (options: { core?: boolean; custom?: boolean }) => {
      const { config, getFormatter, protocolRegistry, logger } = deps;
      
      const hasFilters = options.core !== undefined || options.custom !== undefined;
      const showCore = options.core ?? !hasFilters;
      const showCustom = options.custom ?? !hasFilters;

      let allTrailers: Record<string, FormattableTrailerDefinition> = {};
      for (const p of protocolRegistry.getAll()) {
        allTrailers = { ...allTrailers, ...getFormattableDefinitions(p) };
      }

      const formattable: FormattableConfigResult = {
        version: config.protocol.version,
        permissive: config.trailers.permissive,
        trailers: allTrailers,
        filters: {
          showCore,
          showCustom,
        },
      };

      const formatter = getFormatter();
      logger.result(formatter.formatConfig(formattable));
    });
}
