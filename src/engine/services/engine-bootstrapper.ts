import { join } from 'node:path';

import { Command } from 'commander';

import { JsonFormatter } from '../cli/formatters/json-formatter.js';
import { TextFormatter } from '../cli/formatters/text-formatter.js';
import { TerminalLogger } from '../cli/io/terminal-logger.js';
// Pure Logic Modules
import { createProtocolContext } from '../core/logic/protocols.js';
import { createQueryTarget } from '../core/logic/query-targets.js';
import { SystemProtocolDefinition } from '../core/logic/system-protocol.js';
import { getEngineVersion } from '../core/logic/version.js';
import { ProtocolMap } from '../core/models/protocol-map.js';
import type { EngineConfig } from '../core/types/config.js';
import type { ProtocolContext, ProtocolDefinition } from '../core/types/protocol-definition.js';
import type { QueryTargetAST } from '../core/types/query.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IIdentityIndex } from '../interfaces/identity-index.js';
import type { ILogger } from '../interfaces/logger.js';
import { LogLevel } from '../interfaces/logger.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { IPrompt } from '../interfaces/prompt.js';
import type { IQueryCache } from '../interfaces/query-cache.js';
import { EngineConfigLoader } from '../shell/fs/config-loader.js';
import { IdentityIndex, NullIdentityIndex } from '../shell/fs/identity-index.js';
import { DynamicProtocolLoader, ProtocolLoader } from '../shell/fs/protocol-loader.js';
import { NullQueryCache, QueryCache } from '../shell/fs/query-cache.js';
import { resolveProtocolRoot } from '../shell/fs/root-resolver.js';
import { GitClient } from '../shell/git/git-client.js';
import { CACHE_DIR, DEFAULT_CACHE_PRUNE_THRESHOLD, PROTOCOLS_DIR_NAME, QUERY_CACHE_DIR } from '../util/constants.js';

/**
 * Shared Infrastructure Bag for functional orchestration.
 */
export interface EngineInfra {
  readonly git: IGitClient;
  readonly cache: IQueryCache;
  readonly identityIndex: IIdentityIndex;
  readonly protocols: ProtocolMap<ProtocolContext>;
  readonly config: EngineConfig;
  readonly logger: ILogger;
  readonly prompt: IPrompt;
  readonly getFormatter: (options?: { visibleTrailers?: readonly string[] | 'all' }) => IOutputFormatter;
  readonly protocolRoot: string;
  readonly cwd: string;
  readonly baseTarget: QueryTargetAST;
}

export interface EngineOptions {
  binaryName: string;
  version: string;
  description: string;
  engineDirName: string;
  configFileName: string;
  defaultConfig: EngineConfig;
  staticProtocols: ProtocolDefinition[];
  prompt: IPrompt;
  jsonFormatterFactory?: (protocols: ProtocolMap<ProtocolContext>, options?: { visibleTrailers?: readonly string[] | 'all' }) => IOutputFormatter;
  textFormatterFactory?: (protocols: ProtocolMap<ProtocolContext>, options: { color: boolean; visibleTrailers?: readonly string[] | 'all' }) => IOutputFormatter;

  onConfigLoaded?: (config: EngineConfig) => Promise<EngineConfig>;
  onProtocolsLoaded?: (protocols: ProtocolDefinition[]) => Promise<ProtocolDefinition[]>;

  hiddenCommands?: string[];
  hiddenGlobalOptions?: string[];

  logger?: ILogger;
  logLevel?: LogLevel;
}

/**
 * Orchestrates the initialization of the Decision Engine.
 * Responsible for root resolution, configuration loading, and shell orchestration wiring.
 */
export class EngineBootstrapper {
  constructor(private readonly options: EngineOptions) {}

  /**
   * Performs the full bootstrap lifecycle.
   */
  async bootstrap(cwd: string = process.cwd(), argv: string[] = process.argv) {
    const useColor = !argv.includes('--no-color');
    const useCache = !argv.includes('--no-cache');
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

    // 2. Load Engine Configuration
    let config = await engineConfigLoader.loadForPath(activeRoot);
    if (!config || Object.keys(config).length === 0) {
        config = { ...this.options.defaultConfig };
    }

    if (this.options.onConfigLoaded) {
      config = await this.options.onConfigLoaded(config);
    }

    // 3. Load & Merge Protocols
    const protocolsDir = join(activeRoot, engineDir, PROTOCOLS_DIR_NAME);
    const protocolLoader = new ProtocolLoader(
        new DynamicProtocolLoader(protocolsDir),
        [...(this.options.staticProtocols || []), SystemProtocolDefinition]
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
      .option('--no-cache', 'Bypass local identity and query caches')
      .option('--no-color', 'Disable terminal colors')
      .option('--no-update-notifier', 'Disable update notification')
      .option('--context <path>', 'Run in the context of a specific directory')
      .option('--format <type>', 'Output format (text, json)', 'text');

    if (this.options.hiddenGlobalOptions) {
        for (const flag of this.options.hiddenGlobalOptions) {
            const opt = program.options.find(o => o.long === flag || o.short === flag);
            if (opt) opt.hideHelp();
        }
    }

    // 5. Initialize Infrastructure Map
    const gitClient: IGitClient = new GitClient(activeRoot);
    const protocolMap = new ProtocolMap<ProtocolContext>();
    
    for (const def of allProtocols) {
      protocolMap.set(def.name, createProtocolContext(def));
    }
    
    const fingerprint = Array.from(protocolMap.values())
        .map(ctx => `${ctx.name}@${ctx.version}`)
        .sort()
        .join(';');

    const queryCache: IQueryCache = (config.cache.query && useCache)
      ? new QueryCache(
          join(activeRoot, this.options.engineDirName, CACHE_DIR, QUERY_CACHE_DIR),
          config.cache.pruneThreshold || DEFAULT_CACHE_PRUNE_THRESHOLD,
          `engine@${getEngineVersion()};${fingerprint}`,
        )
      : new NullQueryCache();

    const identityIndex: IIdentityIndex = (config.cache.identity && useCache)
      ? new IdentityIndex(
          join(activeRoot, this.options.engineDirName, CACHE_DIR, 'identity')
        )
      : new NullIdentityIndex();

    const baseTarget = createQueryTarget(undefined, {
      cwd,
      protocolRoot: activeRoot,
      isScoped
    });

    // 6. Formatter factory
    const getFormatter = (options?: { visibleTrailers?: readonly string[] | 'all' }): IOutputFormatter => {
      const opts = program.opts();
      const isJson = opts.json || opts.format === 'json';

      if (isJson) {
        return this.options.jsonFormatterFactory
          ? this.options.jsonFormatterFactory(protocolMap, options)
          : new JsonFormatter(protocolMap);
      } else {
        return this.options.textFormatterFactory
          ? this.options.textFormatterFactory(protocolMap, { color: opts.color, ...options })
          : new TextFormatter(protocolMap, { color: opts.color });
      }
    };
// 7. Consolidate into Infrastructure Bag
const infra: EngineInfra = {
  git: gitClient,
  cache: queryCache,
  identityIndex,
  protocols: protocolMap,
  config,
  logger,
  prompt: this.options.prompt,
  getFormatter,
  protocolRoot: activeRoot,
  cwd,
  baseTarget,
};

    return { program, getFormatter, infra, config };
  }
}
