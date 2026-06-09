import { join } from 'node:path';

import { Command } from 'commander';

import {
  registerCacheCommand,
  registerCommitCommand,
  registerConfigCommand,
  registerDoctorCommand,
  registerLogCommand,
  registerSearchCommand,
  registerSquashCommand,
  registerStaleCommand,
  registerTraceCommand,
  registerValidateCommand,
  registerWhyCommand,
} from '../cli/commands/index.js';
import { JsonFormatter } from '../cli/formatters/json-formatter.js';
import { TextFormatter } from '../cli/formatters/text-formatter.js';
import { TerminalLogger } from '../cli/io/terminal-logger.js';
// Pure Logic Modules
import { createProtocolContext } from '../core/logic/protocols.js';
import { createQueryTarget } from '../core/logic/query-targets.js';
import { getEngineVersion } from '../core/logic/version.js';
import type { EngineConfig } from '../core/types/config.js';
import type { ProtocolDefinition } from '../core/types/protocol-definition.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { ILogger } from '../interfaces/logger.js';
import { LogLevel } from '../interfaces/logger.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { IPrompt } from '../interfaces/prompt.js';
import type { IQueryCache } from '../interfaces/query-cache.js';
import { EngineConfigLoader } from '../shell/fs/config-loader.js';
import { DynamicProtocolLoader, ProtocolLoader } from '../shell/fs/protocol-loader.js';
import { QueryCache } from '../shell/fs/query-cache.js';
import { resolveProtocolRoot } from '../shell/fs/root-resolver.js';
import { GitClient } from '../shell/git/git-client.js';
import { CACHE_DIR, DEFAULT_CACHE_PRUNE_THRESHOLD, PROTOCOLS_DIR_NAME,QUERY_CACHE_DIR } from '../util/constants.js';
import { AtomRepository } from './atom-repository.js';
import {  ProtocolRegistry  } from './protocol-registry.js';

export interface EngineOptions {
  binaryName: string;
  version: string;
  description: string;
  engineDirName: string;
  configFileName: string;
  defaultConfig: EngineConfig;
  staticProtocols: ProtocolDefinition[];
  prompt: IPrompt;
  jsonFormatterFactory?: (registry: ProtocolRegistry) => IOutputFormatter;
  textFormatterFactory?: (registry: ProtocolRegistry, options: { color: boolean }) => IOutputFormatter;

  onConfigLoaded?: (config: EngineConfig) => Promise<EngineConfig>;
  onProtocolsLoaded?: (protocols: ProtocolDefinition[]) => Promise<ProtocolDefinition[]>;

  hiddenCommands?: string[];
  hiddenGlobalOptions?: string[];

  logger?: ILogger;
  logLevel?: LogLevel;
}

/**
 * Orchestrates the initialization of the Decision Engine.
 * Responsible for root resolution, configuration loading, service wiring, 
 * and command registration.
 */
export class EngineBootstrapper {
  constructor(private readonly options: EngineOptions) {}

  /**
   * Performs the full bootstrap lifecycle.
   */
  async bootstrap(cwd: string = process.cwd(), argv: string[] = process.argv) {
    const useColor = !argv.includes('--no-color');
    const logger = this.options.logger || new TerminalLogger(this.options.logLevel ?? LogLevel.INFO, useColor);

    const program = new Command();
    const engineDir = this.options.engineDirName;
    const configFile = this.options.configFileName;

    // 1. Resolve Roots
    const tempGitClient = new GitClient(cwd);
    const engineConfigLoader = new EngineConfigLoader(
        engineDir, 
        configFile, 
        this.options.defaultConfig
    );
    const { protocolRoot, isScoped } = await resolveProtocolRoot(cwd, engineConfigLoader, tempGitClient);
    const activeRoot = protocolRoot || cwd;

    // 2. Load Engine Configuration - ensure defaults are used if file is missing
    let config = await engineConfigLoader.loadForPath(activeRoot);
    if (!config || Object.keys(config).length === 0) {
        config = { ...this.options.defaultConfig };
    }

    if (this.options.onConfigLoaded) {
      config = await this.options.onConfigLoaded(config);
    }

    // 3. Load & Merge Protocols using the new ProtocolLoader
    const protocolsDir = join(activeRoot, engineDir, PROTOCOLS_DIR_NAME);
    const protocolLoader = new ProtocolLoader(
        new DynamicProtocolLoader(protocolsDir),
        this.options.staticProtocols || []
    );

    let allProtocols = await protocolLoader.loadAll(config);
    
    if (this.options.onProtocolsLoaded) {
      allProtocols = await this.options.onProtocolsLoaded(allProtocols);
    }

    program
      .name(this.options.binaryName)
      .version(this.options.version, '--version')
      .description(this.options.description)
      .option('--json', 'Output results in JSON format')
      .option('--no-cache', 'Bypass local atom cache')
      .option('--no-color', 'Disable terminal colors')
      .option('--no-update-notifier', 'Disable update notification')
      .option('--context <path>', 'Run in the context of a specific directory')
      .option('--format <type>', 'Output format (text, json)', 'text');

    // 4b. Handle Hidden Global Options
    if (this.options.hiddenGlobalOptions) {
        for (const flag of this.options.hiddenGlobalOptions) {
            const opt = program.options.find(o => o.long === flag || o.short === flag);
            if (opt) opt.hideHelp();
        }
    }

    // 5. Create primary services
    const gitClient: IGitClient = new GitClient(activeRoot);
    const protocolRegistry = new ProtocolRegistry();
    
    for (const def of allProtocols) {
      protocolRegistry.register(createProtocolContext(def));
    }
    
    const queryCache: IQueryCache = new QueryCache(
      join(activeRoot, this.options.engineDirName, CACHE_DIR, QUERY_CACHE_DIR),
      config.cli.queryCachePruneThreshold || DEFAULT_CACHE_PRUNE_THRESHOLD,
      `engine@${getEngineVersion()};${protocolRegistry.getFingerprint()}`,
    );

    const baseTarget = createQueryTarget(undefined, {
      cwd,
      protocolRoot: activeRoot,
      isScoped
    });

    const atomRepository = new AtomRepository(
      gitClient,
      protocolRegistry,
      queryCache,
      baseTarget,
    );


    // 6. Formatter factory
    let cachedFormatter: IOutputFormatter | null = null;
    const getFormatter = (): IOutputFormatter => {
      if (cachedFormatter !== null) return cachedFormatter;
      const opts = program.opts();
      const isJson = opts.json || opts.format === 'json';

      if (isJson) {
        cachedFormatter = this.options.jsonFormatterFactory
          ? this.options.jsonFormatterFactory(protocolRegistry)
          : new JsonFormatter(protocolRegistry);
      } else {
        cachedFormatter = this.options.textFormatterFactory
          ? this.options.textFormatterFactory(protocolRegistry, { color: opts.color })
          : new TextFormatter(protocolRegistry, { color: opts.color });
      }
      return cachedFormatter;
    };

    // 8. Register Commands
        const sharedDeps = {
      atomRepository,
      gitClient,
      getFormatter,
      config: config,
      logger,
      protocolRegistry,
      protocolRoot: protocolRoot || activeRoot,
      cwd,
    };

    registerWhyCommand(program, sharedDeps);
    registerSearchCommand(program, sharedDeps);
    registerLogCommand(program, sharedDeps);
    registerStaleCommand(program, sharedDeps);
    registerTraceCommand(program, sharedDeps);
    registerCommitCommand(program, sharedDeps, this.options.prompt);
    registerValidateCommand(program, sharedDeps);
    registerSquashCommand(program, sharedDeps);
    registerCacheCommand(program, sharedDeps, join(activeRoot, this.options.engineDirName, CACHE_DIR));
    registerConfigCommand(program, sharedDeps);
    registerDoctorCommand(program, sharedDeps);

    // 8b. Handle Hidden Commands
    if (this.options.hiddenCommands) {
        for (const name of this.options.hiddenCommands) {
            const cmd = program.commands.find(c => c.name() === name);
            if (cmd) (cmd as unknown as { _hidden: boolean })._hidden = true;
        }
    }

    return { program, getFormatter, sharedDeps, config };
  }
}
