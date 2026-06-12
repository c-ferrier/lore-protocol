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
    type ProtocolDefinition,
    runCli, TerminalPrompt, 
    type TrailerDefinition    } from '../engine/index.js';
import { registerConstraintsCommand } from './commands/constraints.js';
import { registerContextCommand } from './commands/context.js';
import { registerDirectivesCommand } from './commands/directives.js';
import { registerInitCommand } from './commands/init.js';
import { registerRejectedCommand } from './commands/rejected.js';
import { registerSearchCommand } from './commands/search.js';
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
    jsonFormatterFactory: (protocols) => new LoreJsonFormatter(protocols),
    textFormatterFactory: (protocols, opts: { color: boolean }) => new LoreTextFormatter(protocols, opts),

    // Rebranding Surface: Hide internal engine parts not in 0.5.0
    hiddenCommands: ['cache', 'config'],
    hiddenGlobalOptions: ['--no-cache', '--context', '--format'],

    // Hook: Merge legacy .lore/config.toml settings into engine config
    onConfigLoaded: async (config: EngineConfig): Promise<EngineConfig> => {
        if (!legacyData) return config;

        // 1. Translate global Engine settings using declarative rules
        const result = mapConfig(legacyData as unknown as Record<string, unknown>, config as unknown as Record<string, unknown>, LORE_TO_ENGINE_RULES) as unknown as EngineConfig;

        // 2. Translate Legacy Lore Protocols to Engine protocols bucket
        const loreOverrides: Partial<ProtocolDefinition> = {
            version: legacyData.protocol?.version || '1.0',
            strict: legacyData.validation?.strict !== undefined ? legacyData.validation.strict : false,
            trailers: {}
        };

        const standardTrailers = new Set(Object.keys(LoreProtocolDefinition.trailers));
        let hasCustomTrailers = false;
        const trailerMap = loreOverrides.trailers as Record<string, TrailerDefinition>;

        // Translate legacy custom arrays
        for (const key of legacyData.trailers?.custom || []) {
            if (!standardTrailers.has(key)) hasCustomTrailers = true;
            trailerMap[key] = {
                description: `Custom project trailer: ${key}`,
                multivalue: true,
                validation: 'none'
            };
        }

        // Translate legacy required arrays
        for (const key of legacyData.trailers?.required || []) {
            if (!standardTrailers.has(key)) hasCustomTrailers = true;
            if (trailerMap[key]) {
                trailerMap[key] = { ...trailerMap[key], required: true };
            } else {
                trailerMap[key] = {
                    description: `Custom project trailer: ${key}`,
                    multivalue: true,
                    validation: 'none',
                    required: true
                };
            }
        }

        (loreOverrides as unknown as { permissive: boolean }).permissive = !hasCustomTrailers;
        
        return {
            ...result,
            protocols: {
                ...result.protocols,
                lore: loreOverrides as Partial<ProtocolDefinition>
            }
        } as EngineConfig;
    },
    ...overrides
  };

  const { program, getFormatter, infra, config } = await runCli(options);
  const { logger } = infra;

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
  registerContextCommand(program, infra);
  registerSearchCommand(program, infra);
  registerConstraintsCommand(program, infra);
  registerDirectivesCommand(program, infra);
  registerTestedCommand(program, infra);
  registerRejectedCommand(program, infra);

  // 0.5.0 Shims: Global Descriptions
  const jsonOpt = program.options.find(o => o.long === '--json');
  if (jsonOpt) updateOpt(jsonOpt, { description: 'Shorthand for --format json' });

  const formatOpt = program.options.find(o => o.long === '--format');
  if (formatOpt) updateOpt(formatOpt, { description: 'Output format: text or json (default: "text")' });

  const noColorOpt = program.options.find(o => o.long === '--no-color');
  if (noColorOpt) updateOpt(noColorOpt, { description: 'Disable colored output' });

  const versionOpt = program.options.find(o => o.long === '--version');
  if (versionOpt) updateOpt(versionOpt, { description: 'output the version number' });

  // --- REBRANDING & SHIMMING WRAPPER (Commander level) ---
  const loreProtocol = infra.protocols.get('lore');

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
              updateOpt(opt, { description: opt.description.slice(7) });
          }
          if (opt.description.startsWith('[lore] ')) {
              updateOpt(opt, { description: opt.description.slice(7) });
          }
      }

      // 3. Command-specific 0.5.0 Shims
      if (name === 'commit') {
          const shim = (flag: string, desc: string) => {
              const opt = cmd.options.find(o => o.long === flag);
              if (opt) updateOpt(opt, { description: desc });
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
              updateOpt(subjectOpt, { 
                  hidden: true, 
                  description: 'Primary subject line (why the change was made)' 
              });
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
                          // Explicitly namespace the trailer to ensure it binds to the Lore protocol
                          for (const v of vals) trailerArray.push(`lore/${key}=${v}`);
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
          if (maxDepthOpt) updateOpt(maxDepthOpt, { description: 'Maximum BFS traversal depth (default: 10)' });
          hideOpt(cmd, '--until');
      }

      if (name === 'doctor') {
          cmd.description('Health check: broken refs, config issues');
          hideOpt(cmd, '--until');
      }

      if (name === 'search') {
          cmd.description('Search across all lore with filters');
          const textOpt = cmd.options.find(o => o.long === '--text');
          if (textOpt) updateOpt(textOpt, { description: 'Full-text search across intent, body, and trailer values' });
          
          const hasOpt = cmd.options.find(o => o.long === '--has');
          if (hasOpt) updateOpt(hasOpt, { description: 'Filter atoms that contain this trailer type' });

          const scopeOpt = cmd.options.find(o => o.long === '--scope');
          if (scopeOpt) updateOpt(scopeOpt, { description: 'Filter by conventional commit scope' });

          const maxCommitsOpt = cmd.options.find(o => o.long === '--max-commits');
          if (maxCommitsOpt) updateOpt(maxCommitsOpt, { description: 'Maximum git commits to scan (supersession may be incomplete)' });

          const sinceOpt = cmd.options.find(o => o.long === '--since');
          if (sinceOpt) updateOpt(sinceOpt, { description: 'Only consider commits since ref/date' });

          const untilOpt = cmd.options.find(o => o.long === '--until');
          if (untilOpt) updateOpt(untilOpt, { description: 'Upper time/revision bound' });

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
          if (subjectOpt) updateOpt(subjectOpt, { hidden: true });
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
          if (maxCommitsOpt) updateOpt(maxCommitsOpt, { description: 'Maximum git commits to scan (supersession may be incomplete)' });
          if (name === 'rejected') cmd.description('Previously rejected alternatives for a code region');
          if (name === 'directives') cmd.description('Active forward-looking warnings for a code region');
      }
  }

  return { program, getFormatter, infra, config };
}

/**
 * Helper to hide an option on a command.
 */
function hideOpt(cmd: Command, flag: string) {
  const opt = cmd.options.find(o => o.long === flag || o.short === flag);
  if (opt) updateOpt(opt, { hidden: true });
}

/**
 * Helper to safely update commander options without generic 'any' casts.
 */
function updateOpt(opt: unknown, updates: { description?: string; hidden?: boolean }) {
    const o = opt as { description: string; hidden: boolean };
    if (updates.description !== undefined) o.description = updates.description;
    if (updates.hidden !== undefined) o.hidden = updates.hidden;
}
