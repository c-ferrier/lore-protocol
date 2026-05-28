import { runCli, execute, type EngineOptions } from '../engine/index.js';
import { ProtocolRegistry } from '../engine/services/protocol-registry.js';
import { LoreProtocolDefinition } from './protocol-definition.js';
import { LORE_DEFAULT_CONFIG, LORE_CONFIG_DIR, LORE_CONFIG_FILENAME } from './defaults.js';
import { ENGINE_CONFIG_FILENAME, ENGINE_DIR_NAME, TRAILER_UI_KINDS, TRAILER_UI_COLORS } from '../util/constants.js';
import { registerInitCommand } from './commands/init.js';
import { registerContextCommand } from './commands/context.js';
import { registerConstraintsCommand } from './commands/constraints.js';
import { registerDirectivesCommand } from './commands/directives.js';
import { registerTestedCommand } from './commands/tested.js';
import { registerRejectedCommand } from './commands/rejected.js';
import { LoreJsonFormatter } from './formatters/lore-json-formatter.js';
import { LoreTextFormatter } from './formatters/lore-text-formatter.js';
import { LoreLegacyLoader, type Lore050Config } from './services/legacy-loader.js';
import { resolve, join } from 'node:path';
import type { EngineConfig, ProtocolConfig, CustomTrailerDefinition, ValueDefinition, TrailerUiKind, TrailerUiColor } from '../engine/types/config.js';
import type { ProtocolDefinition } from '../engine/interfaces/protocol-definition.js';

function resolveValues(valuesRaw: any): Record<string, ValueDefinition> | undefined {
  if (Array.isArray(valuesRaw)) {
    const result: Record<string, ValueDefinition> = {};
    for (const opt of valuesRaw) if (typeof opt === 'string') result[opt] = { description: '' };
    return result;
  }
  if (valuesRaw && typeof valuesRaw === 'object') {
    const result: Record<string, ValueDefinition> = {};
    for (const [key, value] of Object.entries(valuesRaw)) {
      if (typeof value === 'string') result[key] = { description: value };
      else if (value && typeof value === 'object') {
        result[key] = { description: typeof (value as any).description === 'string' ? (value as any).description : '' };
      }
    }
    return result;
  }
  return undefined;
}

function resolveDefinitions(rawData: Record<string, any>): Record<string, CustomTrailerDefinition> {
  const result: Record<string, CustomTrailerDefinition> = {};

  for (const [key, value] of Object.entries(rawData)) {
    if (!value || typeof value !== 'object') continue;
    const def = value as any;
    
    let validation: 'values' | 'pattern' | 'none' = 'none';
    if (def.validation === 'values' || def.validation === 'options') {
      validation = 'values';
    } else if (def.validation === 'pattern') {
      validation = 'pattern';
    }

    const uiRaw = typeof def.ui === 'object' && def.ui !== null ? def.ui : undefined;

    result[key] = {
      description: typeof def.description === 'string' ? def.description : '',
      multivalue: typeof def.multivalue === 'boolean' ? def.multivalue : false,
      validation,
      values: resolveValues(def.values || def.options),
      pattern: typeof def.pattern === 'string' ? def.pattern : undefined,
      required: typeof def.required === 'boolean' ? def.required : false,
      ui: uiRaw ? {
        kind: (TRAILER_UI_KINDS as readonly string[]).includes(uiRaw.kind as string) 
          ? uiRaw.kind as TrailerUiKind 
          : undefined,
        color: (TRAILER_UI_COLORS as readonly string[]).includes(uiRaw.color as string) 
          ? uiRaw.color as TrailerUiColor 
          : undefined,
      } : undefined,
    };
  }
  return result;
}

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
    description: 'CLI tool for the Lore protocol -- structured decision context in git commits',
    engineDirName: ENGINE_DIR_NAME,
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
        
        // Translate Legacy LoreConfig to EngineConfig overrides
        const validation: any = {};
        if (legacyData.validation?.strict !== undefined) validation.strict = legacyData.validation.strict;
        if (legacyData.validation?.max_message_lines !== undefined) validation.maxMessageLines = legacyData.validation.max_message_lines;
        if (legacyData.validation?.intent_max_length !== undefined) validation.subjectMaxLength = legacyData.validation.intent_max_length;
        else if (legacyData.validation?.subject_max_length !== undefined) validation.subjectMaxLength = legacyData.validation.subject_max_length;

        const stale: any = {};
        if (legacyData.stale?.older_than) stale.olderThan = legacyData.stale.older_than;
        if (legacyData.stale?.drift_threshold) stale.driftThreshold = legacyData.stale.drift_threshold;

        const output: any = {};
        if (legacyData.output?.default_format) output.defaultFormat = legacyData.output.default_format;

        const cli: any = {};
        if (legacyData.cli?.update_check !== undefined) cli.updateCheck = legacyData.cli.update_check;
        if (legacyData.cli?.cache !== undefined) cli.cache = legacyData.cli.cache;

        return {
            ...config,
            validation: { ...config.validation, ...validation },
            stale: { ...config.stale, ...stale },
            cli: { ...config.cli, ...cli },
            output: { ...config.output, ...output } as any,
        };
    },

    // Hook: Provide per-protocol runtime configuration (Legacy Parity)
    getProtocolConfig: (name: string): ProtocolConfig => {
        if (name === 'Lore' && legacyData) {
            let permissive = legacyData.trailers?.permissive !== undefined ? legacyData.trailers.permissive : true;
            const definitions = resolveDefinitions(legacyData.trailers?.definitions || {});
            
            // 0.5.0 Legacy Rule: If ANY custom definitions exist, permissive mode defaults to false 
            // unless explicitly set to true.
            if (Object.keys(definitions).length > 0 && legacyData.trailers?.permissive === undefined) {
                permissive = false;
            }

            return {
                version: legacyData.protocol?.version || '1.0',
                trailers: {
                    required: legacyData.trailers?.required || [],
                    custom: legacyData.trailers?.custom || [],
                    definitions,
                    permissive
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
  const { logger } = sharedDeps;

  // --- REBRANDING WRAPPER (Commander level) ---
  
  // Register Lore-specific commands FIRST so they can be shimmed in the loop
  registerInitCommand(program, {
    getFormatter,
    engineDirName: options.engineDirName,
    configFileName: options.configFileName,
    defaultConfig: options.defaultConfig,
    logger
  });
  registerContextCommand(program, sharedDeps);
  registerConstraintsCommand(program, sharedDeps);
  registerDirectivesCommand(program, sharedDeps);
  registerTestedCommand(program, sharedDeps);
  registerRejectedCommand(program, sharedDeps);

  // 0.5.0 Shims: Global Descriptions and Hidden Additives
  const hideGlobal = (f: string) => {
    const opt = program.options.find(o => o.long === f);
    if (opt) (opt as any).hidden = true;
  };

  hideGlobal('--no-cache');
  hideGlobal('--context');
  hideGlobal('--format');

  const jsonOpt = program.options.find(o => o.long === '--json');
  if (jsonOpt) (jsonOpt as any).description = 'Shorthand for --format json';

  const formatOpt = program.options.find(o => o.long === '--format');
  if (formatOpt) (formatOpt as any).description = 'Output format: text or json (default: "text")';

  const noColorOpt = program.options.find(o => o.long === '--no-color');
  if (noColorOpt) (noColorOpt as any).description = 'Disable colored output';

  const versionOpt = program.options.find(o => o.long === '--version');
  if (versionOpt) (versionOpt as any).description = 'output the version number';

  // Add 0.5.0 missing global no-op
  program.option('--no-update-notifier', 'Disable update notification');

  // 1. Dynamic Prefix Stripping & 0.5.0 Trailer Shims
  for (const cmd of program.commands) {
      const name = cmd.name();

      // Hide global engine commands not in 0.5.0
      if (['cache', 'config'].includes(name)) {
          (cmd as any)._hidden = true;
      }

      // Strip [Lore] prefix from any option description
      for (const opt of cmd.options) {
          if (opt.description.startsWith('[Lore] ')) {
              (opt as any).description = opt.description.slice(7);
          }
      }

      // Function to hide additive options
      const hideOpt = (f: string) => {
          const opt = cmd.options.find(o => o.long === f);
          if (opt) (opt as any).hidden = true;
      };

      // Exact 0.5.0 String Parity for Core Trailers (Commit Command)
      if (name === 'commit') {
          const shim = (flag: string, desc: string) => {
              const opt = cmd.options.find(o => o.long === flag);
              if (opt) (opt as any).description = desc;
          };
          shim('--constraint', 'Constraint trailer value (repeatable)');
          shim('--rejected', 'Rejected trailer value (repeatable)');
          shim('--confidence', 'Confidence level: low, medium, high');
          shim('--scope-risk', 'Scope-risk level: narrow, moderate, wide');
          shim('--reversibility', 'Reversibility level: clean, migration-needed, irreversible');
          shim('--directive', 'Directive trailer value (repeatable)');
          shim('--tested', 'Tested trailer value (repeatable)');
          shim('--not-tested', 'Not-tested trailer value (repeatable)');
          shim('--supersedes', 'Supersedes Lore-id (repeatable)');
          shim('--depends-on', 'Depends-on Lore-id (repeatable)');
          shim('--related', 'Related Lore-id (repeatable)');
          
          hideOpt('--until');
          hideOpt('--trailer');
          hideOpt('--assisted-by');
          hideOpt('--co-authored-by');

          // Legacy 0.5.0 branding
          cmd.description('Create a Lore-enriched commit');

          // Subject/Intent handling
          const subjectOpt = cmd.options.find(o => o.long === '--subject');
          if (subjectOpt) {
              (subjectOpt as any).hidden = true;
              (subjectOpt as any).description = 'Primary subject line (why the change was made)';
          }
          cmd.option('--intent <text>', 'Intent line (why the change was made)');
          cmd.hook('preAction', (thisCommand) => {
              const opts = thisCommand.opts();
              if (opts.intent) thisCommand.setOptionValue('subject', opts.intent);
          });
      }

      // Command-level 0.5.0 Shims
      if (name === 'log') {
          cmd.description('Lore-enriched git log');
          hideOpt('--scope');
          hideOpt('--follow');
          hideOpt('--all');
          hideOpt('--author');
          hideOpt('--until');
      }
      if (name === 'validate') {
          cmd.description('Validate commits for Lore protocol compliance');
          hideOpt('--until');
      }
      if (name === 'why') {
          cmd.description('Decision context for a specific line or line range');
          hideOpt('--scope');
          hideOpt('--follow');
          hideOpt('--all');
          hideOpt('--author');
          hideOpt('--limit');
          hideOpt('--max-commits');
          hideOpt('--since');
          hideOpt('--until');
      }
      if (name === 'trace') {
          cmd.description('Follow decision chain from a starting atom');
          const maxDepthOpt = cmd.options.find(o => o.long === '--max-depth');
          if (maxDepthOpt) (maxDepthOpt as any).description = 'Maximum BFS traversal depth (default: 10)';
          hideOpt('--until');
      }
      if (name === 'doctor') {
          cmd.description('Health check: broken refs, config issues');
          hideOpt('--until');
      }
      if (name === 'search') {
          cmd.description('Search across all lore with filters');
          const textOpt = cmd.options.find(o => o.long === '--text');
          if (textOpt) (textOpt as any).description = 'Full-text search across intent, body, and trailer values';
          
          const maxCommitsOpt = cmd.options.find(o => o.long === '--max-commits');
          if (maxCommitsOpt) (maxCommitsOpt as any).description = 'Maximum git commits to scan (supersession may be incomplete)';

          // Re-add Lore semantic filters
          cmd.option('--confidence <level>', 'Filter by confidence: low, medium, high');
          cmd.option('--scope-risk <level>', 'Filter by scope-risk: narrow, moderate, wide');
          cmd.option('--reversibility <level>', 'Filter by reversibility: clean, migration-needed, irreversible');

          cmd.hook('preAction', (thisCommand) => {
              const opts = thisCommand.opts();
              const filters: Record<string, string> = opts.filters || {};
              if (opts.confidence) filters['Confidence'] = opts.confidence;
              if (opts.scopeRisk) filters['Scope-risk'] = opts.scopeRisk;
              if (opts.reversibility) filters['Reversibility'] = opts.reversibility;
              thisCommand.setOptionValue('filters', filters);
          });
      }
      if (name === 'stale') {
          cmd.description('Flag potentially outdated knowledge');
          cmd.option('--low-confidence', 'Flag low-confidence atoms');
          hideOpt('--until');
          
          cmd.hook('preAction', (thisCommand) => {
              const opts = thisCommand.opts();
              const signals: string[] = opts.signals || [];
              if (opts.lowConfidence) signals.push('low-confidence');
              thisCommand.setOptionValue('signals', signals);
          });
      }
      if (name === 'squash') {
          cmd.description('Merge atoms for squash-merge preparation');
          const subjectOpt = cmd.options.find(o => o.long === '--subject');
          if (subjectOpt) (subjectOpt as any).hidden = true;
          cmd.option('--intent <text>', 'Override the intent line of the merged message');
          hideOpt('--until');
          cmd.hook('preAction', (thisCommand) => {
              const opts = thisCommand.opts();
              if (opts.intent) thisCommand.setOptionValue('subject', opts.intent);
          });
      }

      // Shared shims across path-query commands
      const pathQueryCmds = ['context', 'constraints', 'rejected', 'directives', 'tested', 'coverage'];
      if (pathQueryCmds.includes(name)) {
          hideOpt('--until');
          const maxCommitsOpt = cmd.options.find(o => o.long === '--max-commits');
          if (maxCommitsOpt) (maxCommitsOpt as any).description = 'Maximum git commits to scan (supersession may be incomplete)';
          
          if (name === 'rejected') cmd.description('Previously rejected alternatives for a code region');
          if (name === 'directives') cmd.description('Active forward-looking warnings for a code region');
      }
  }

  return { program, getFormatter, sharedDeps, config };
}
