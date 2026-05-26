import { runCli, execute } from '../engine/index.js';
import { LoreProtocolDefinition } from './protocol-definition.js';
import { LORE_DEFAULT_CONFIG, LORE_CONFIG_DIR, LORE_CONFIG_FILENAME } from './defaults.js';
import { registerInitCommand } from './commands/init.js';
import { registerContextCommand } from './commands/context.js';
import { registerConstraintsCommand } from './commands/constraints.js';
import { registerDirectivesCommand } from './commands/directives.js';
import { registerTestedCommand } from './commands/tested.js';
import { registerRejectedCommand } from './commands/rejected.js';
import { LoreJsonFormatter } from './formatters/lore-json-formatter.js';
import { LoreTextFormatter } from './formatters/lore-text-formatter.js';
import { LoreLegacyLoader } from './services/legacy-loader.js';
import { resolve, join } from 'node:path';
import type { EngineConfig } from '../engine/types/config.js';
import type { ProtocolDefinition } from '../engine/interfaces/protocol-definition.js';

/**
 * Lore CLI Compatibility Layer.
 * Wraps the agnostic Atom engine with Lore-specific commands and configuration.
 */
export async function runLore() {
  const { program, getFormatter, config } = await buildLoreCli();
  await execute(program, getFormatter, config);
}

/**
 * Assembly logic for the Lore CLI.
 * Returns the configured program and dependencies for testing or execution.
 */
export async function buildLoreCli() {
  // 1. Initialize the Legacy Loader (relative to CWD)
  const legacyLoader = new LoreLegacyLoader(join(process.cwd(), LORE_CONFIG_DIR, LORE_CONFIG_FILENAME));
  const legacyData = await legacyLoader.load();

  const options = {
    binaryName: 'lore',
    description: 'Structured decision context in git commits',
    engineDirName: '.atom',
    configFileName: 'config.toml',
    defaultConfig: LORE_DEFAULT_CONFIG as unknown as EngineConfig,
    staticProtocols: [LoreProtocolDefinition],
    packageJsonPath: resolve(new URL('../../package.json', import.meta.url).pathname),
    
    // Inject Legacy Parity Formatters
    jsonFormatterFactory: (registry: any) => new LoreJsonFormatter(registry),
    textFormatterFactory: (registry: any, opts: any) => new LoreTextFormatter(registry, opts),

    // Hook: Merge legacy .lore/config.toml settings into engine config
    onConfigLoaded: async (config: EngineConfig): Promise<EngineConfig> => {
        if (!legacyData) return config;
        const overrides = legacyData.engineOverrides;
        return {
            ...config,
            validation: { ...config.validation, ...overrides.validation },
            stale: { ...config.stale, ...overrides.stale },
            cli: { ...config.cli, ...overrides.cli },
            output: { ...config.output, ...overrides.output } as any,
            follow: { ...config.follow, ...overrides.follow } as any,
        };
    },

    // Hook: Apply legacy protocol overrides (permissive mode, custom trailers)
    onProtocolsLoaded: async (protocols: ProtocolDefinition[]) => {
        if (!legacyData || !legacyData.protocolConfig) return protocols;
        
        return protocols.map(p => {
            if (p.name === 'Lore') {
                const updatedTrailers = { ...p.trailers };
                if (legacyData.protocolConfig.trailers) {
                    Object.assign(updatedTrailers, legacyData.protocolConfig.trailers.definitions);
                }

                return {
                    ...p,
                    version: legacyData.protocolConfig.version || p.version,
                    trailers: updatedTrailers,
                    // If custom trailers exist, Lore 0.5.0 defaults to strict mode (permissive: false)
                    // This logic is already handled inside LoreLegacyLoader.load()
                };
            }
            return p;
        });
    }
  };

  const { program, getFormatter, sharedDeps, config } = await runCli(options);

  // --- REBRANDING WRAPPER (Commander level) ---
  const commitCmd = program.commands.find(c => c.name() === 'commit');
  if (commitCmd) {
    const subjectOpt = commitCmd.options.find(o => o.long === '--subject');
    if (subjectOpt) (subjectOpt as any).hidden = true;
    commitCmd.option('--intent <text>', 'Intent line (why the change was made)');
    commitCmd.hook('preAction', (thisCommand) => {
        const opts = thisCommand.opts();
        if (opts.intent) thisCommand.setOptionValue('subject', opts.intent);
    });
  }

  const squashCmd = program.commands.find(c => c.name() === 'squash');
  if (squashCmd) {
    const subjectOpt = squashCmd.options.find(o => o.long === '--subject');
    if (subjectOpt) (subjectOpt as any).hidden = true;
    squashCmd.option('--intent <text>', 'Override the intent line of the merged message');
    squashCmd.hook('preAction', (thisCommand) => {
        const opts = thisCommand.opts();
        if (opts.intent) thisCommand.setOptionValue('subject', opts.intent);
    });
  }

  // 0.5.0 Parity: Command Descriptions and Options
  const searchCmd = program.commands.find(c => c.name() === 'search');
  if (searchCmd) {
      searchCmd.description('Search across all lore with filters');
      const textOpt = searchCmd.options.find(o => o.long === '--text');
      if (textOpt) (textOpt as any).description = 'Full-text search across intent, body, and trailer values';
  }

  const staleCmd = program.commands.find(c => c.name() === 'stale');
  if (staleCmd) staleCmd.description('Flag potentially outdated knowledge');

  // Register Lore-specific commands
  registerInitCommand(program, { 
    getFormatter, 
    protocolName: LoreProtocolDefinition.name 
  });

  registerContextCommand(program, sharedDeps);
  registerConstraintsCommand(program, sharedDeps);
  registerDirectivesCommand(program, sharedDeps);
  registerTestedCommand(program, sharedDeps);
  registerRejectedCommand(program, sharedDeps);

  return { program, getFormatter, sharedDeps, config };
}
