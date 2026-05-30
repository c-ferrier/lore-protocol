import { Command } from 'commander';
import { join } from 'node:path';
import { ProtocolRegistry } from './protocol-registry.js';
import { Protocol } from './protocol.js';
import { TrailerParser } from './trailer-parser.js';
import { PathResolver } from './path-resolver.js';
import { SearchFilter } from './search-filter.js';
import { AtomRepository } from './atom-repository.js';
import { AtomCache } from './atom-cache.js';
import { QueryCache } from './query-cache.js';
import { IdGenerator } from './id-generator.js';
import { SupersessionResolver } from './supersession-resolver.js';
import { LogLevel } from '../interfaces/logger.js';
import { TerminalLogger } from './terminal-logger.js';
import { DEFAULT_CACHE_PRUNE_THRESHOLD, CACHE_DIR, ATOM_CACHE_DIR, QUERY_CACHE_DIR, PROTOCOLS_DIR_NAME } from '../util/constants.js';
import { StalenessDetector } from './staleness-detector.js';
import { CommitBuilder } from './commit-builder.js';
import { SquashMerger } from './squash-merger.js';
import { Validator } from './validator.js';
import { TerminalPrompt } from './terminal-prompt.js';
import { CommitInputResolver } from './commit-input-resolver.js';
import { HeadIdReader } from './head-id-reader.js';
import { resolveProtocolRoot } from './root-resolver.js';
import { DynamicProtocolLoader } from './protocol-loader.js';
import { ProtocolLoader } from './protocol/protocol-loader.js';
import { getEngineVersion } from '../util/version.js';
import { JsonFormatter } from '../formatters/json-formatter.js';
import { TextFormatter } from '../formatters/text-formatter.js';
import { GitClient } from './git-client.js';
import { EngineConfigLoader } from './config-loader.js';

import {
  registerWhyCommand,
  registerSearchCommand,
  registerLogCommand,
  registerStaleCommand,
  registerTraceCommand,
  registerCommitCommand,
  registerValidateCommand,
  registerSquashCommand,
  registerCacheCommand,
  registerConfigCommand,
  registerDoctorCommand,
} from '../commands/index.js';

import type { IGitClient } from '../interfaces/git-client.js';
import type { ProtocolDefinition } from '../interfaces/protocol-definition.js';
import type { EngineConfig } from '../types/config.js';
import type { IAtomCache } from '../interfaces/atom-cache.js';
import type { IQueryCache } from '../interfaces/query-cache.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { ILogger } from '../interfaces/logger.js';

export interface EngineOptions {
  binaryName: string;
  version: string;
  description: string;
  engineDirName: string;
  configFileName: string;
  defaultConfig: EngineConfig;
  staticProtocols: ProtocolDefinition[];
  jsonFormatterFactory?: (registry: ProtocolRegistry) => IOutputFormatter;
  textFormatterFactory?: (registry: ProtocolRegistry, options: { color: boolean }) => IOutputFormatter;
  
  onConfigLoaded?: (config: EngineConfig) => Promise<EngineConfig>;
  onProtocolsLoaded?: (protocols: ProtocolDefinition[]) => Promise<ProtocolDefinition[]>;

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

    // 1. Resolve Roots
    const tempGitClient = new GitClient(cwd);
    const engineConfigLoader = new EngineConfigLoader(this.options.engineDirName, this.options.configFileName, this.options.defaultConfig);
    const { protocolRoot, gitRoot } = await resolveProtocolRoot(cwd, engineConfigLoader, tempGitClient);
    const activeRoot = protocolRoot || cwd;

    // 2. Load Engine Configuration
    let config = await engineConfigLoader.loadForPath(activeRoot);
    if (this.options.onConfigLoaded) {
      config = await this.options.onConfigLoaded(config);
    }

    // 3. Load & Merge Protocols using the new ProtocolLoader
    const protocolsDir = join(activeRoot, this.options.engineDirName, PROTOCOLS_DIR_NAME);
    const protocolLoader = new ProtocolLoader(
        new DynamicProtocolLoader(protocolsDir),
        this.options.staticProtocols || []
    );

    let allProtocols = await protocolLoader.loadAll(config);
    
    if (this.options.onProtocolsLoaded) {
      allProtocols = await this.options.onProtocolsLoaded(allProtocols);
    }

    // Determine if we are running in a scoped context
    const isScoped = !!gitRoot && !!protocolRoot && protocolRoot !== gitRoot;

    program
      .name(this.options.binaryName)
      .version(this.options.version, '--version')
      .description(this.options.description)
      .option('--json', 'Output results in JSON format')
      .option('--no-cache', 'Bypass local atom cache')
      .option('--no-color', 'Disable terminal colors')
      .option('--context <path>', 'Run in the context of a specific directory')
      .option('--format <type>', 'Output format (text, json)', 'text');

    // 5. Create primary services
    const gitClient: IGitClient = new GitClient(activeRoot);
    const protocolRegistry = new ProtocolRegistry();
    
    for (const def of allProtocols) {
      protocolRegistry.register(new Protocol(def));
    }
    
    const trailerParser = new TrailerParser();
    const pathResolver = new PathResolver(cwd, activeRoot);
    const searchFilter = new SearchFilter(protocolRegistry);
    
    const atomCache: IAtomCache = new AtomCache(
      join(activeRoot, this.options.engineDirName, CACHE_DIR, ATOM_CACHE_DIR),
    );

    const queryCache: IQueryCache = new QueryCache(
      join(activeRoot, this.options.engineDirName, CACHE_DIR, QUERY_CACHE_DIR),
      config.cli.queryCachePruneThreshold || DEFAULT_CACHE_PRUNE_THRESHOLD,
      `engine@${getEngineVersion()};${protocolRegistry.getFingerprint()}`,
    );

    const atomRepository = new AtomRepository(
      gitClient,
      trailerParser,
      protocolRegistry,
      searchFilter,
      pathResolver,
      atomCache,
      queryCache,
      isScoped,
    );

    const idGenerator = new IdGenerator();
    const supersessionResolver = new SupersessionResolver(protocolRegistry);
    const stalenessDetector = new StalenessDetector(gitClient, config, protocolRegistry);
    const commitBuilder = new CommitBuilder(trailerParser, idGenerator, config, protocolRegistry);
    const squashMerger = new SquashMerger(idGenerator, protocolRegistry);
    const validator = new Validator(trailerParser, atomRepository, config, protocolRegistry);
    const prompt = new TerminalPrompt();
    const commitInputResolver = new CommitInputResolver(prompt, protocolRegistry);
    const headIdReader = new HeadIdReader(gitClient, trailerParser, protocolRegistry);

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
      commitInputResolver,
      headIdReader,
      getFormatter,
      config: config as any,
      logger,
      protocolRegistry,
      trailerParser,
      commitBuilder,
      squashMerger,
      validator,
      supersessionResolver,
      stalenessDetector,
      pathResolver,
      searchFilter,
      configLoader: engineConfigLoader as any,
      isScoped,
      protocolRoot: protocolRoot || activeRoot,
      gitRoot: gitRoot || activeRoot,
      engineDirName: this.options.engineDirName,
      configFileName: this.options.configFileName,
      cacheDir: join(activeRoot, this.options.engineDirName, CACHE_DIR),
      defaultConfig: this.options.defaultConfig,
    };

    registerWhyCommand(program, sharedDeps);
    registerSearchCommand(program, sharedDeps);
    registerLogCommand(program, sharedDeps);
    registerStaleCommand(program, sharedDeps);
    registerTraceCommand(program, sharedDeps);
    registerCommitCommand(program, sharedDeps);
    registerValidateCommand(program, sharedDeps);
    registerSquashCommand(program, sharedDeps);
    registerCacheCommand(program, sharedDeps);
    registerConfigCommand(program, sharedDeps);
    registerDoctorCommand(program, sharedDeps);

    return { program, getFormatter, sharedDeps, config };
  }
}
