import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitClient } from './services/git-client.js';
import { ConfigLoader } from './services/config-loader.js';
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
import { StalenessDetector } from './services/staleness-detector.js';
import { CommitBuilder } from './services/commit-builder.js';
import { SquashMerger } from './services/squash-merger.js';
import { Validator } from './services/validator.js';
import { TerminalPrompt } from './services/terminal-prompt.js';
import { CommitInputResolver } from './services/commit-input-resolver.js';
import { HeadIdReader } from './services/head-id-reader.js';
import { resolveProtocolRoot } from './services/root-resolver.js';
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
import type { Config } from './types/config.js';
import type { IAtomCache } from './interfaces/atom-cache.js';
import type { IQueryCache } from './interfaces/query-cache.js';
import type { IOutputFormatter } from './interfaces/output-formatter.js';

export interface EngineOptions {
  binaryName: string;
  description: string;
  engineDirName: string;
  protocolDirName?: string;
  configFileName: string;
  defaultConfig: Config;
  protocols: ProtocolDefinition[];
  packageJsonPath: string;
  jsonFormatterFactory?: (registry: ProtocolRegistry) => IOutputFormatter;
  textFormatterFactory?: (registry: ProtocolRegistry, options: { color: boolean }) => IOutputFormatter;
}

/**
 * Generic bootstrap for the Decision Engine CLI.
 */
export async function runCli(options: EngineOptions) {
  const program = new Command();

  // 1. Load Engine Configuration (Global/Local Engine Settings)
  const engineConfigLoader = new ConfigLoader(
    options.engineDirName,
    options.configFileName,
    options.defaultConfig
  );

  // 2. Resolve Engine Root
  const tempGitClient = new GitClient(process.cwd());
  const { protocolRoot: engineRoot, gitRoot } = await resolveProtocolRoot(process.cwd(), engineConfigLoader, tempGitClient);

  // 3. Load Protocol Configuration if a separate dir is provided (e.g. .lore)
  let config = await engineConfigLoader.loadForPath(engineRoot || process.cwd());
  let protocolRoot = engineRoot;
  let protocolConfigLoader = engineConfigLoader;

  if (options.protocolDirName && options.protocolDirName !== options.engineDirName) {
    protocolConfigLoader = new ConfigLoader(
      options.protocolDirName,
      options.configFileName,
      config // Use engine config as base for protocol config
    );
    const { protocolRoot: pRoot } = await resolveProtocolRoot(process.cwd(), protocolConfigLoader, tempGitClient);
    if (pRoot) {
      protocolRoot = pRoot;
      config = await protocolConfigLoader.loadForPath(pRoot);
    }
  }

  // Determine if we are running in a scoped context (protocol root is a subfolder of git root)
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

  // 5. Create primary services with resolved root context
  const gitClient: IGitClient = new GitClient(protocolRoot);
  const protocolRegistry = new ProtocolRegistry();
  
  // Register provided protocols
  for (const def of options.protocols) {
    protocolRegistry.register(new Protocol(def, config));
  }
  
  const trailerParser = new TrailerParser();
  const pathResolver = new PathResolver(process.cwd(), protocolRoot);
  const searchFilter = new SearchFilter(protocolRegistry);
  
  const atomCache: IAtomCache = new AtomCache(
    join(protocolRoot || process.cwd(), options.engineDirName, CACHE_DIR, ATOM_CACHE_DIR),
  );

  const queryCache: IQueryCache = new QueryCache(
    join(protocolRoot || process.cwd(), options.engineDirName, CACHE_DIR, QUERY_CACHE_DIR),
    config.cli.queryCachePruneThreshold || DEFAULT_CACHE_PRUNE_THRESHOLD,
  );

  // Fallback protocol for UI context (prefer root namespace)
  const defaultProtocol: IProtocol | undefined = protocolRegistry.getRoot() || protocolRegistry.getAll()[0];

  const atomRepository = new AtomRepository(
    gitClient,
    trailerParser,
    defaultProtocol,
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
    // Non-blocking update check was successful
  }

  // 7. Formatter factory
  let cachedFormatter: IOutputFormatter | null = null;
  const getFormatter = (): IOutputFormatter => {
    if (cachedFormatter !== null) {
      return cachedFormatter;
    }
    const opts = program.opts();
    const isJson = opts.json || opts.format === 'json';

    if (isJson) {
      cachedFormatter = options.jsonFormatterFactory
        ? options.jsonFormatterFactory(protocolRegistry)
        : new JsonFormatter(protocolRegistry);
    } else {
      cachedFormatter = options.textFormatterFactory
        ? options.textFormatterFactory(protocolRegistry, { color: !opts.noColor })
        : new TextFormatter(protocolRegistry, { color: !opts.noColor });
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
    config,
    protocol: defaultProtocol,
    protocolRegistry,
    trailerParser,
    commitBuilder,
    squashMerger,
    validator,
    supersessionResolver,
    stalenessDetector,
    pathResolver,
    searchFilter,
    configLoader: protocolConfigLoader,
    cacheDir: join(protocolRoot || process.cwd(), options.engineDirName, CACHE_DIR),
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
export async function execute(program: Command, getFormatter: () => IOutputFormatter, config: Config) {
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
