import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitClient } from './services/git-client.js';
import { EngineConfigLoader } from './services/config-loader.js';
import { Protocol } from './services/protocol.js';
import { ProtocolRegistry } from './services/protocol-registry.js';
import { TrailerParser } from './services/trailer-parser.js';
import { PathResolver } from './services/path-resolver.js';
import { SearchFilter } from './services/search-filter.js';
import { AtomRepository } from './services/atom-repository.js';
import { AtomCache } from './services/atom-cache.js';
import { QueryCache } from './services/query-cache.js';
import { IdGenerator } from './services/id-generator.js';
import { SupersessionResolver } from './services/supersession-resolver.js';
import { type ILogger, LogLevel } from './interfaces/logger.js';
import { TerminalLogger } from './services/terminal-logger.js';
import { PROTOCOLS_DIR_NAME } from '../util/constants.js';
import { StalenessDetector } from './services/staleness-detector.js';
import { CommitBuilder } from './services/commit-builder.js';
import { SquashMerger } from './services/squash-merger.js';
import { Validator } from './services/validator.js';
import { TerminalPrompt } from './services/terminal-prompt.js';
import { CommitInputResolver } from './services/commit-input-resolver.js';
import { HeadIdReader } from './services/head-id-reader.js';
import { resolveProtocolRoot } from './services/root-resolver.js';
import { DynamicProtocolLoader } from './services/protocol-loader.js';
import { shouldCheckForUpdate } from '../util/update-check.js';
import { getDisplayVersion } from '../util/version.js';
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
} from './commands/index.js';
import { JsonFormatter } from './formatters/json-formatter.js';
import { TextFormatter } from './formatters/text-formatter.js';
import { DEFAULT_CACHE_PRUNE_THRESHOLD, CACHE_DIR, ATOM_CACHE_DIR, QUERY_CACHE_DIR } from '../util/constants.js';

import type { IGitClient } from './interfaces/git-client.js';
import type { IProtocol } from './interfaces/protocol.js';
import type { ProtocolDefinition } from './interfaces/protocol-definition.js';
import type { EngineConfig, ProtocolConfig } from './types/config.js';
import type { IAtomCache } from './interfaces/atom-cache.js';
import type { IQueryCache } from './interfaces/query-cache.js';
import type { IOutputFormatter } from './interfaces/output-formatter.js';

export interface EngineOptions {
  binaryName: string;
  description: string;
  engineDirName: string;
  configFileName: string;
  defaultConfig: EngineConfig;
  staticProtocols: ProtocolDefinition[];
  packageJsonPath: string;
  jsonFormatterFactory?: (registry: ProtocolRegistry) => IOutputFormatter;
  textFormatterFactory?: (registry: ProtocolRegistry, options: { color: boolean }) => IOutputFormatter;
  
  // Hooks for Wrappers (e.g. Lore) to mutate state before bootstrap
  onConfigLoaded?: (config: EngineConfig) => Promise<EngineConfig>;
  onProtocolsLoaded?: (protocols: ProtocolDefinition[]) => Promise<ProtocolDefinition[]>;

  // Per-protocol runtime configuration provider
  getProtocolConfig?: (name: string) => ProtocolConfig;

  /** Optional logger implementation. If not provided, a TerminalLogger is used. */
  logger?: ILogger;
  /** Optional log level. Defaults to INFO. */
  logLevel?: LogLevel;
}

/**
 * Generic bootstrap for the Decision Engine CLI.
 */
export async function runCli(options: EngineOptions) {
  /** 
   * 0. Initialize Logger
   * DESIGN NOTE: We ideally want to depend on Commander.js parsed options,
   * but the logger is initialized during the early bootstrap phase before
   * full parsing is complete. Thus, we must check process.argv directly 
   * for '--no-color' to ensure early bootstrap logs are correctly styled.
   */
  const useColor = !process.argv.includes('--no-color');
  const logger = options.logger || new TerminalLogger(options.logLevel ?? LogLevel.INFO, useColor);

  const program = new Command();

  // 1. Resolve Roots
  const tempGitClient = new GitClient(process.cwd());
  const engineConfigLoader = new EngineConfigLoader(options.engineDirName, options.configFileName, options.defaultConfig);
  const { protocolRoot, gitRoot } = await resolveProtocolRoot(process.cwd(), engineConfigLoader, tempGitClient);
  const activeRoot = protocolRoot || process.cwd();

  // 2. Load Engine Configuration
  let config = await engineConfigLoader.loadForPath(activeRoot);
  if (options.onConfigLoaded) {
    config = await options.onConfigLoaded(config);
  }

  // 3. Load Protocols
  const protocolsDir = join(activeRoot, options.engineDirName, PROTOCOLS_DIR_NAME);
  const dynamicLoader = new DynamicProtocolLoader(protocolsDir);
  const dynamicProtocols = await dynamicLoader.loadAll();
  
  // Create unique registry map, prioritizing dynamic over static
  const protocolMap = new Map<string, ProtocolDefinition>();
  for (const p of options.staticProtocols) {
      protocolMap.set(p.name.toLowerCase(), p);
  }
  for (const p of dynamicProtocols) {
      protocolMap.set(p.name.toLowerCase(), p);
  }

  let allProtocols = Array.from(protocolMap.values());
  
  if (options.onProtocolsLoaded) {
    allProtocols = await options.onProtocolsLoaded(allProtocols);
  }

  // Determine if we are running in a scoped context
  const isScoped = !!gitRoot && !!protocolRoot && protocolRoot !== gitRoot;

  // 4. Global Options
  const packageJson = JSON.parse(readFileSync(options.packageJsonPath, 'utf-8'));

  program
    .name(options.binaryName)
    .version(getDisplayVersion(packageJson.version), '--version')
    .description(options.description)
    .option('--json', 'Output results in JSON format')
    .option('--no-cache', 'Bypass local atom cache')
    .option('--no-color', 'Disable terminal colors')
    .option('--context <path>', 'Run in the context of a specific directory')
    .option('--format <type>', 'Output format (text, json)', 'text');

  // 5. Create primary services
  const gitClient: IGitClient = new GitClient(activeRoot);
  const protocolRegistry = new ProtocolRegistry();
  
  const defaultProtocolConfig: ProtocolConfig = {
    version: '1.0',
    trailers: { required: [], custom: [], definitions: {}, permissive: true }
  };

  for (const def of allProtocols) {
    const pConfig = options.getProtocolConfig 
        ? options.getProtocolConfig(def.name)
        : defaultProtocolConfig;
    protocolRegistry.register(new Protocol(def, pConfig));
  }
  
  const trailerParser = new TrailerParser();
  const pathResolver = new PathResolver(process.cwd(), activeRoot);
  const searchFilter = new SearchFilter(protocolRegistry);
  
  const atomCache: IAtomCache = new AtomCache(
    join(activeRoot, options.engineDirName, CACHE_DIR, ATOM_CACHE_DIR),
  );

  const queryCache: IQueryCache = new QueryCache(
    join(activeRoot, options.engineDirName, CACHE_DIR, QUERY_CACHE_DIR),
    config.cli.queryCachePruneThreshold || DEFAULT_CACHE_PRUNE_THRESHOLD,
    `engine@${packageJson.version};${protocolRegistry.getFingerprint()}`,
  );

  const atomRepository = new AtomRepository(
    gitClient,
    trailerParser,
    protocolRegistry,
    searchFilter,
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

  // 6. Check for updates
  if (config.cli.updateCheck && await shouldCheckForUpdate(packageJson.version)) {
    // Non-blocking update check
  }

  // 7. Formatter factory
  let cachedFormatter: IOutputFormatter | null = null;
  const getFormatter = (): IOutputFormatter => {
    if (cachedFormatter !== null) return cachedFormatter;
    const opts = program.opts();
    const isJson = opts.json || opts.format === 'json';

    if (isJson) {
      cachedFormatter = options.jsonFormatterFactory
        ? options.jsonFormatterFactory(protocolRegistry)
        : new JsonFormatter(protocolRegistry);
    } else {
      cachedFormatter = options.textFormatterFactory
        ? options.textFormatterFactory(protocolRegistry, { color: opts.color })
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
    engineDirName: options.engineDirName,
    configFileName: options.configFileName,
    cacheDir: join(activeRoot, options.engineDirName, CACHE_DIR),
    defaultConfig: options.defaultConfig,
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

/**
 * Executes the configured commander program.
 */
export async function execute(program: Command, getFormatter: () => IOutputFormatter, config: EngineConfig) {
  try {
    await program.parseAsync(process.argv);
  } catch (error: unknown) {
    const formatter = getFormatter();
    if (error instanceof Error) {
      console.error(formatter.formatError(1, [{ severity: 'error', message: error.message }]));
    } else {
      console.error(formatter.formatError(1, [{ severity: 'error', message: String(error) }]));
    }
    process.exit(1);
  }
}
