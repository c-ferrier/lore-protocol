import { runCli, execute, type EngineOptions } from '../engine/index.js';
import { ProtocolRegistry } from '../engine/services/protocol-registry.js';
import { LoreProtocolDefinition } from './protocol-definition.js';
import { LORE_DEFAULT_CONFIG, LORE_CONFIG_DIR, LORE_CONFIG_FILENAME } from './defaults.js';
import { ENGINE_CONFIG_FILENAME } from '../util/constants.js';
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
import type { EngineConfig, ProtocolConfig } from '../engine/types/config.js';
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

  const options: EngineOptions = {
    binaryName: 'lore',
    description: 'Structured decision context in git commits',
    engineDirName: '.atom',
    configFileName: ENGINE_CONFIG_FILENAME,
    defaultConfig: LORE_DEFAULT_CONFIG as unknown as EngineConfig,
    staticProtocols: [LoreProtocolDefinition],
    packageJsonPath: resolve(new URL('../../package.json', import.meta.url).pathname),
    
    // Inject Legacy Parity Formatters
    jsonFormatterFactory: (registry: ProtocolRegistry) => new LoreJsonFormatter(registry),
    textFormatterFactory: (registry: ProtocolRegistry, opts: { color: boolean }) => new LoreTextFormatter(registry, opts),

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

    // Hook: Provide per-protocol runtime configuration (Legacy Parity)
    getProtocolConfig: (name: string): ProtocolConfig => {
        if (name === 'Lore' && legacyData?.protocolConfig) {
            return {
                version: legacyData.protocolConfig.version || '1.0',
                trailers: {
                    required: legacyData.protocolConfig.trailers?.required || [],
                    custom: legacyData.protocolConfig.trailers?.custom || [],
                    definitions: legacyData.protocolConfig.trailers?.definitions || {},
                    permissive: legacyData.protocolConfig.trailers?.permissive !== undefined 
                        ? legacyData.protocolConfig.trailers.permissive 
                        : true
                }
            };
        }
        
        // Generic default for other protocols
        return {
            version: '1.0',
            trailers: { required: [], custom: [], definitions: {}, permissive: true }
        };
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

  const logCmd = program.commands.find(c => c.name() === 'log');
  if (logCmd) logCmd.description('Lore-enriched git log');

  const validateCmd = program.commands.find(c => c.name() === 'validate');
  if (validateCmd) validateCmd.description('Validate commits for Lore protocol compliance');

  const whyCmd = program.commands.find(c => c.name() === 'why');
  if (whyCmd) whyCmd.description('Decision context for a specific line or line range (Lore)');

  // 0.5.0 Parity: Command Descriptions and Options
  const searchCmd = program.commands.find(c => c.name() === 'search');
  if (searchCmd) {
      searchCmd.description('Search across all lore with filters');
      const textOpt = searchCmd.options.find(o => o.long === '--text');
      if (textOpt) (textOpt as any).description = 'Full-text search across intent, body, and trailer values';

      // Re-add Lore semantic filters
      searchCmd.option('--confidence <level>', 'Filter by confidence: low, medium, high');
      searchCmd.option('--scope-risk <level>', 'Filter by scope-risk: narrow, moderate, wide');
      searchCmd.option('--reversibility <level>', 'Filter by reversibility: clean, migration-needed, irreversible');

      searchCmd.hook('preAction', (thisCommand) => {
          const opts = thisCommand.opts();
          const filters: Record<string, string> = opts.filters || {};
          if (opts.confidence) filters['Confidence'] = opts.confidence;
          if (opts.scopeRisk) filters['Scope-risk'] = opts.scopeRisk;
          if (opts.reversibility) filters['Reversibility'] = opts.reversibility;
          thisCommand.setOptionValue('filters', filters);
      });
  }

  const staleCmd = program.commands.find(c => c.name() === 'stale');
  if (staleCmd) {
      staleCmd.description('Flag potentially outdated knowledge');
      staleCmd.option('--low-confidence', 'Flag low-confidence atoms');
      
      staleCmd.hook('preAction', (thisCommand) => {
          const opts = thisCommand.opts();
          const signals: string[] = opts.signals || [];
          if (opts.lowConfidence) signals.push('low-confidence');
          thisCommand.setOptionValue('signals', signals);
      });
  }

  // Register Lore-specific commands
  registerInitCommand(program, { 
    getFormatter, 
    engineDirName: options.engineDirName,
    configFileName: options.configFileName,
    defaultConfig: options.defaultConfig 
  });

  registerContextCommand(program, sharedDeps);
  registerConstraintsCommand(program, sharedDeps);
  registerDirectivesCommand(program, sharedDeps);
  registerTestedCommand(program, sharedDeps);
  registerRejectedCommand(program, sharedDeps);

  return { program, getFormatter, sharedDeps, config };
}
