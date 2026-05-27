import type { Command } from 'commander';
import type { IConfigLoader } from '../interfaces/config-loader.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { FormattableConfigResult, FormattableTrailerDefinition } from '../types/output.js';
import type { ProtocolRegistry } from '../services/protocol-registry.js';

/**
 * Register the config command.
 * Outputs the effective configuration for the current path.
 */
export function registerConfigCommand(
  program: Command,
  deps: {
    configLoader: IConfigLoader;
    getFormatter: () => IOutputFormatter;
    protocolRegistry: ProtocolRegistry;
  },
): void {
  program
    .command('config')
    .description('Show effective configuration')
    .option('--core', 'Show only core trailer definitions')
    .option('--custom', 'Show only custom trailer definitions')
    .action(async (options: { core?: boolean; custom?: boolean }) => {
      const { configLoader, getFormatter, protocolRegistry } = deps;
      const config = await configLoader.loadForPath(process.cwd());
      
      const hasFilters = options.core !== undefined || options.custom !== undefined;
      const showCore = options.core ?? !hasFilters;
      const showCustom = options.custom ?? !hasFilters;

      let allTrailers: Record<string, FormattableTrailerDefinition> = {};
      for (const p of protocolRegistry.getAll()) {
        allTrailers = { ...allTrailers, ...p.getFormattableDefinitions() };
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
      console.log(formatter.formatConfig(formattable));
    });
}
