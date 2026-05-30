import { runCli, execute, type EngineOptions } from '../engine/index.js';
import { ProtocolRegistry } from '../engine/services/protocol-registry.js';
import { LoreProtocolDefinition } from './protocol-definition.js';
import { LORE_CONFIG_DIR, LORE_CONFIG_FILENAME } from './defaults.js';
import { ENGINE_CONFIG_FILENAME, ENGINE_DIR_NAME, TRAILER_UI_KINDS, TRAILER_UI_COLORS } from '../engine/util/constants.js';
import { DEFAULT_ENGINE_CONFIG } from '../engine/defaults.js';
import { registerInitCommand } from './commands/init.js';
import { registerContextCommand } from './commands/context.js';
import { registerConstraintsCommand } from './commands/constraints.js';
import { registerDirectivesCommand } from './commands/directives.js';
import { registerTestedCommand } from './commands/tested.js';
import { registerRejectedCommand } from './commands/rejected.js';
import { LoreJsonFormatter } from './formatters/lore-json-formatter.js';
import { LoreTextFormatter } from './formatters/lore-text-formatter.js';
import { LoreConfigLoader } from './services/lore-config-loader.js';
import { ProtocolHydrator } from '../engine/services/protocol-hydrator.js';
import { getLoreVersion, getLorePackageName, getLorePublishedVersion } from './util/version.js';
import { getEngineVersion, getEnginePackageName, getEnginePublishedVersion } from '../engine/util/version.js';
import { checkForUpdates } from '../engine/util/update-check.js';
import { resolve, join } from 'node:path';
import type { EngineConfig, ProtocolConfig, TrailerDefinition, ValueDefinition, TrailerUiKind, TrailerUiColor } from '../engine/types/config.js';
import type { ProtocolDefinition } from '../engine/interfaces/protocol-definition.js';
import type { LoreConfig } from './defaults.js';

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
  const legacyLoader = new LoreConfigLoader(join(process.cwd(), LORE_CONFIG_DIR, LORE_CONFIG_FILENAME));
  const legacyData = await legacyLoader.load();

  const options: EngineOptions = {
    binaryName: 'lore',
    version: `${getLoreVersion()} (${getEnginePackageName()}: ${getEngineVersion()})`,
    description: 'CLI tool for the Lore protocol -- structured decision context in git commits',
    engineDirName: ENGINE_DIR_NAME,
    configFileName: ENGINE_CONFIG_FILENAME,
    defaultConfig: DEFAULT_ENGINE_CONFIG,
    staticProtocols: [LoreProtocolDefinition],
    
    // Inject Legacy Parity Formatters
    jsonFormatterFactory: (registry: ProtocolRegistry) => new LoreJsonFormatter(registry),
    textFormatterFactory: (registry: ProtocolRegistry, opts: { color: boolean }) => new LoreTextFormatter(registry, opts),

    // Hook: Merge legacy .lore/config.toml settings into engine config
    onConfigLoaded: async (config: EngineConfig): Promise<EngineConfig> => {
        if (!legacyData) return config;
        
        // 1. Translate Legacy LoreConfig to EngineConfig overrides
        const validation: any = {};
        if (legacyData.validation?.strict !== undefined) validation.strict = legacyData.validation.strict;
        if (legacyData.validation?.max_message_lines !== undefined) validation.maxMessageLines = legacyData.validation.max_message_lines;
        if (legacyData.validation?.intent_max_length !== undefined) validation.subjectMaxLength = legacyData.validation.intent_max_length;

        const stale: any = {};
        if (legacyData.stale?.older_than) stale.olderThan = legacyData.stale.older_than;
        if (legacyData.stale?.drift_threshold) stale.driftThreshold = legacyData.stale.drift_threshold;

        const output: any = {};
        if (legacyData.output?.default_format) output.defaultFormat = legacyData.output.default_format;

        const follow: any = {};
        if (legacyData.follow?.max_depth !== undefined) follow.maxDepth = legacyData.follow.max_depth;

        const cli: any = {};
        if (legacyData.cli?.update_check !== undefined) cli.updateCheck = legacyData.cli.update_check;

        // 2. Translate Legacy Lore Protocols to Engine protocols bucket
        const loreOverrides: any = {
            version: legacyData.protocol?.version || '1.0',
            strict: false,
            trailers: {}
        };

        const standardTrailers = new Set(Object.keys(LoreProtocolDefinition.trailers));
        let hasCustomTrailers = false;

        // Translate legacy custom arrays
        for (const key of legacyData.trailers?.custom || []) {
            if (!standardTrailers.has(key)) hasCustomTrailers = true;
            loreOverrides.trailers[key] = {
                description: `Custom project trailer: ${key}`,
                multivalue: true,
                validation: 'none'
            };
        }

        // Translate legacy required arrays
        for (const key of legacyData.trailers?.required || []) {
            if (!standardTrailers.has(key)) hasCustomTrailers = true;
            if (loreOverrides.trailers[key]) {
                loreOverrides.trailers[key].required = true;
            } else {
                loreOverrides.trailers[key] = {
                    description: '',
                    multivalue: true,
                    validation: 'none',
                    required: true
                };
            }
        }

        loreOverrides.permissive = !hasCustomTrailers;

        return {
            ...config,
            validation: { ...config.validation, ...validation },
            stale: { ...config.stale, ...stale },
            cli: { ...config.cli, ...cli },
            follow: { ...config.follow, ...follow },
            output: { ...config.output, ...output } as any,
            protocols: {
                ...config.protocols,
                Lore: loreOverrides
            }
        };
    },
  };

  const { program, getFormatter, sharedDeps, config } = await runCli(options);
  const { logger } = sharedDeps;

  // Non-blocking update checks for both the wrapper and the library
  if (config.cli.updateCheck) {
    void checkForUpdates({
        packageName: getLorePackageName(),
        currentVersion: getLorePublishedVersion(),
        configEnabled: true
    });
    
    void checkForUpdates({
        packageName: getEnginePackageName(),
        currentVersion: getEnginePublishedVersion(),
        configEnabled: true
    });
  }

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
          
          const hasOpt = cmd.options.find(o => o.long === '--has');
          if (hasOpt) (hasOpt as any).description = 'Filter atoms that contain this trailer type';

          const scopeOpt = cmd.options.find(o => o.long === '--scope');
          if (scopeOpt) (scopeOpt as any).description = 'Filter by conventional commit scope';

          const maxCommitsOpt = cmd.options.find(o => o.long === '--max-commits');
          if (maxCommitsOpt) (maxCommitsOpt as any).description = 'Maximum git commits to scan (supersession may be incomplete)';

          const sinceOpt = cmd.options.find(o => o.long === '--since');
          if (sinceOpt) (sinceOpt as any).description = 'Only consider commits since ref/date';

          const untilOpt = cmd.options.find(o => o.long === '--until');
          if (untilOpt) (untilOpt as any).description = 'Upper time/revision bound';

          hideOpt('--follow');

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
