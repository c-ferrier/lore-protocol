import { join } from 'node:path';

import type { Command } from 'commander';

import { 
    camelCase,
    checkForUpdates,
    DEFAULT_ENGINE_CONFIG,
    ENGINE_CONFIG_FILENAME, 
    ENGINE_DIR_NAME, 
    type EngineConfig, 
    type EngineOptions,
    execute, 
    getEnginePackageName, 
    getEnginePublishedVersion,
    getEngineVersion,
    ProtocolRegistry,
    runCli, TerminalPrompt, 
    type TrailerDefinition    } from '../engine/index.js';
import { registerConstraintsCommand } from './commands/constraints.js';
import { registerContextCommand } from './commands/context.js';
import { registerDirectivesCommand } from './commands/directives.js';
import { registerInitCommand } from './commands/init.js';
import { registerRejectedCommand } from './commands/rejected.js';
import { registerTestedCommand } from './commands/tested.js';
import { LORE_CONFIG_DIR, LORE_CONFIG_FILENAME } from './defaults.js';
import { LoreJsonFormatter } from './formatters/lore-json-formatter.js';
import { LoreTextFormatter } from './formatters/lore-text-formatter.js';
import { LoreProtocolDefinition } from './protocol-definition.js';
import { LoreConfigLoader } from './services/lore-config-loader.js';
import { LORE_TO_ENGINE_RULES,mapConfig } from './util/config-mapper.js';
import { getLorePackageName, getLorePublishedVersion,getLoreVersion } from './util/version.js';

/**
 * Lore CLI Compatibility Layer.
 * Wraps the agnostic Atom engine with Lore-specific commands and configuration.
 */
export async function runLore() {
  const { program, getFormatter } = await buildLoreCli();
  await execute(program, getFormatter);
}

/**
 * Assembly logic for the Lore CLI.
 * Returns the configured program and dependencies for testing or execution.
 */
export async function buildLoreCli(overrides: Partial<EngineOptions> = {}) {
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
    prompt: new TerminalPrompt(),
    
    // Inject Legacy Parity Formatters
    jsonFormatterFactory: (registry: ProtocolRegistry) => new LoreJsonFormatter(registry),
    textFormatterFactory: (registry: ProtocolRegistry, opts: { color: boolean }) => new LoreTextFormatter(registry, opts),

    // Rebranding Surface: Hide internal engine parts not in 0.5.0
    hiddenCommands: ['cache', 'config'],
    hiddenGlobalOptions: ['--no-cache', '--context', '--format'],

    // Hook: Merge legacy .lore/config.toml settings into engine config
    onConfigLoaded: async (config: EngineConfig): Promise<EngineConfig> => {
        if (!legacyData) return config;

        // 1. Translate global Engine settings using declarative rules
        const result = mapConfig(legacyData, config, LORE_TO_ENGINE_RULES);

        // 2. Translate Legacy Lore Protocols to Engine protocols bucket
        const loreOverrides: any = {
            version: legacyData.protocol?.version || '1.0',
            strict: legacyData.validation?.strict !== undefined ? legacyData.validation.strict : false,
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
        
        result.protocols = {
            ...result.protocols,
            lore: loreOverrides
        };

        return result as EngineConfig;
    },
    ...overrides
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
  
  // Register Lore-specific commands
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

  // 0.5.0 Shims: Global Descriptions
  const jsonOpt = program.options.find(o => o.long === '--json');
  if (jsonOpt) (jsonOpt as any).description = 'Shorthand for --format json';

  const formatOpt = program.options.find(o => o.long === '--format');
  if (formatOpt) (formatOpt as any).description = 'Output format: text or json (default: "text")';

  const noColorOpt = program.options.find(o => o.long === '--no-color');
  if (noColorOpt) (noColorOpt as any).description = 'Disable colored output';

  const versionOpt = program.options.find(o => o.long === '--version');
  if (versionOpt) (versionOpt as any).description = 'output the version number';

  // --- REBRANDING & SHIMMING WRAPPER (Commander level) ---
  const loreProtocol = sharedDeps.protocolRegistry.get('lore');

  for (const cmd of program.commands) {
      const name = cmd.name();

      // 1. Dynamic Flag Generation (0.5.0 parity)
      if (name === 'commit' && loreProtocol) {
          for (const [key, tDef] of Object.entries(loreProtocol.def.trailers)) {
              if (key === loreProtocol.def.identityKey) continue;

              const def = tDef as TrailerDefinition;
              const flagName = def.cli?.flag || key.toLowerCase().replace(/[^a-z0-9]+/g, '-');
              cmd.option(`--${flagName} <value...>`, `[lore] ${def.description}`);
          }
      }

      // 2. Prefix Stripping
      for (const opt of cmd.options) {
          if (opt.description.startsWith('[Lore] ')) {
              (opt as any).description = opt.description.slice(7);
          }
          if (opt.description.startsWith('[lore] ')) {
              (opt as any).description = opt.description.slice(7);
          }
      }

      // 3. Command-specific 0.5.0 Shims
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

          hideOpt(cmd, '--until');
          hideOpt(cmd, '--trailer');
          hideOpt(cmd, '--assisted-by');
          hideOpt(cmd, '--co-authored-by');

          cmd.description('Create a Lore-enriched commit');

          const subjectOpt = cmd.options.find(o => o.long === '--subject');
          if (subjectOpt) {
              (subjectOpt as any).hidden = true;
              (subjectOpt as any).description = 'Primary subject line (why the change was made)';
          }
          cmd.option('--intent <text>', 'Intent line (why the change was made)');
          cmd.hook('preAction', (thisCommand) => {
              const opts = thisCommand.opts();
              if (opts.intent) thisCommand.setOptionValue('subject', opts.intent);

              const trailerArray: string[] = opts.trailer || [];
              if (loreProtocol) {
                  for (const [key, tDef] of Object.entries(loreProtocol.def.trailers)) {
                      if (key === loreProtocol.def.identityKey) continue;
                      const def = tDef as TrailerDefinition;
                      const flagName = def.cli?.flag || key.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                      const camelFlag = camelCase(flagName);
                      if (opts[camelFlag]) {
                          const vals = Array.isArray(opts[camelFlag]) ? opts[camelFlag] : [opts[camelFlag]];
                          for (const v of vals) trailerArray.push(`${key}=${v}`);
                      }
                  }
              }
              if (trailerArray.length > 0) thisCommand.setOptionValue('trailer', trailerArray);
          });
      }

      if (name === 'log') {
          cmd.description('Lore-enriched git log');
          hideOpt(cmd, '--scope');
          hideOpt(cmd, '--follow');
          hideOpt(cmd, '--all');
          hideOpt(cmd, '--author');
          hideOpt(cmd, '--until');
          hideOpt(cmd, '--filter');
          hideOpt(cmd, '--history');
          hideOpt(cmd, '--text');
          hideOpt(cmd, '--has');
      }
      
      if (name === 'validate') {
          cmd.description('Validate commits for Lore protocol compliance');
          hideOpt(cmd, '--until');
      }

      if (name === 'why') {
          cmd.description('Decision context for a specific line or line range');
          hideOpt(cmd, '--scope');
          hideOpt(cmd, '--follow');
          hideOpt(cmd, '--all');
          hideOpt(cmd, '--history');
          hideOpt(cmd, '--author');
          hideOpt(cmd, '--limit');
          hideOpt(cmd, '--max-commits');
          hideOpt(cmd, '--since');
          hideOpt(cmd, '--until');
          hideOpt(cmd, '--filter');
          hideOpt(cmd, '--text');
          hideOpt(cmd, '--has');
      }

      if (name === 'trace') {
          cmd.description('Follow decision chain from a starting atom');
          const maxDepthOpt = cmd.options.find(o => o.long === '--max-depth');
          if (maxDepthOpt) (maxDepthOpt as any).description = 'Maximum BFS traversal depth (default: 10)';
          hideOpt(cmd, '--until');
      }

      if (name === 'doctor') {
          cmd.description('Health check: broken refs, config issues');
          hideOpt(cmd, '--until');
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

          hideOpt(cmd, '--follow');
          hideOpt(cmd, '--filter');
          hideOpt(cmd, '--history');

          cmd.option('--confidence <level>', 'Filter by confidence: low, medium, high');
          cmd.option('--scope-risk <level>', 'Filter by scope-risk: narrow, moderate, wide');
          cmd.option('--reversibility <level>', 'Filter by reversibility: clean, migration-needed, irreversible');

          cmd.hook('preAction', (thisCommand) => {
              const opts = thisCommand.opts();
              const filterArray: string[] = opts.filter || [];
              if (opts.confidence) filterArray.push(`Confidence=${opts.confidence}`);
              if (opts.scopeRisk) filterArray.push(`Scope-risk=${opts.scopeRisk}`);
              if (opts.reversibility) filterArray.push(`Reversibility=${opts.reversibility}`);
              if (filterArray.length > 0) thisCommand.setOptionValue('filter', filterArray);
          });
      }

      if (name === 'stale') {
          cmd.description('Flag potentially outdated knowledge');
          cmd.option('--low-confidence', 'Flag low-confidence atoms');
          hideOpt(cmd, '--until');
          
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
          hideOpt(cmd, '--until');
          cmd.hook('preAction', (thisCommand) => {
              const opts = thisCommand.opts();
              if (opts.intent) thisCommand.setOptionValue('subject', opts.intent);
          });
      }

      const pathQueryCmds = ['context', 'constraints', 'rejected', 'directives', 'tested', 'coverage'];
      if (pathQueryCmds.includes(name)) {
          hideOpt(cmd, '--until');
          hideOpt(cmd, '--filter');
          hideOpt(cmd, '--history');
          hideOpt(cmd, '--text');
          hideOpt(cmd, '--has');
          const maxCommitsOpt = cmd.options.find(o => o.long === '--max-commits');
          if (maxCommitsOpt) (maxCommitsOpt as any).description = 'Maximum git commits to scan (supersession may be incomplete)';
          if (name === 'rejected') cmd.description('Previously rejected alternatives for a code region');
          if (name === 'directives') cmd.description('Active forward-looking warnings for a code region');
      }
  }

  return { program, getFormatter, sharedDeps, config };
}

/**
 * Helper to hide an option on a command.
 */
function hideOpt(cmd: Command, flag: string) {
  const opt = cmd.options.find(o => o.long === flag || o.short === flag);
  if (opt) (opt as any).hidden = true;
}
