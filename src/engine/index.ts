import { Command } from 'commander';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import type { IGitClient } from './interfaces/git-client.js';
import type { IAtomCache } from './interfaces/atom-cache.js';
import type { IQueryCache } from './interfaces/query-cache.js';
import type { IOutputFormatter } from './interfaces/output-formatter.js';
import type { Config } from './types/config.js';
import type { ProtocolDefinition } from './interfaces/protocol-definition.js';
import type { IProtocol } from './interfaces/protocol.js';

import { GitClient } from './services/git-client.js';
import { TrailerParser } from './services/trailer-parser.js';
import { IdGenerator } from './services/id-generator.js';
import { AtomRepository } from './services/atom-repository.js';
import { Validator } from './services/validator.js';
import { ConfigLoader } from './services/config-loader.js';
import { resolveProtocolRoot } from './services/root-resolver.js';
import { PathResolver } from './services/path-resolver.js';
import { SquashMerger } from './services/squash-merger.js';
import { StalenessDetector } from './services/staleness-detector.js';
import { SupersessionResolver } from './services/supersession-resolver.js';
import { CommitBuilder } from './services/commit-builder.js';
import { CommitInputResolver } from './services/commit-input-resolver.js';
import { HeadIdReader } from './services/head-id-reader.js';
import { SearchFilter } from './services/search-filter.js';
import { Protocol } from './services/protocol.js';
import { ProtocolRegistry } from './services/protocol-registry.js';

import { TextFormatter } from './formatters/text-formatter.js';
import { JsonFormatter } from './formatters/json-formatter.js';

import { registerWhyCommand } from './commands/why.js';
import { registerSearchCommand } from './commands/search.js';
import { registerLogCommand } from './commands/log.js';
import { registerStaleCommand } from './commands/stale.js';
import { registerTraceCommand } from './commands/trace.js';
import { registerCommitCommand } from './commands/commit.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerSquashCommand } from './commands/squash.js';
import { registerCacheCommand } from './commands/cache.js';
import { registerConfigCommand } from './commands/config.js';
import { registerDoctorCommand } from './commands/doctor.js';

import {
  CACHE_DIR,
  ATOM_CACHE_DIR,
  QUERY_CACHE_DIR,
  DEFAULT_CACHE_PRUNE_THRESHOLD,
} from '../util/constants.js';
import { ProtocolError, ValidationError, GitError } from '../util/errors.js';
import { TerminalPrompt } from './services/terminal-prompt.js';
import { AtomCache } from './services/atom-cache.js';
import { QueryCache } from './services/query-cache.js';
import { shouldCheckForUpdate } from '../util/update-check.js';
import { getDisplayVersion } from '../util/version.js';

export interface EngineOptions {
  readonly binaryName: string;
  readonly description: string;
  readonly engineDirName: string;       // e.g. '.atom'
  readonly protocolDirName?: string;    // e.g. '.lore' (optional)
  readonly configFileName: string;
  readonly defaultConfig: Config;
  readonly protocols: readonly ProtocolDefinition[];
  readonly packageJsonPath: string;
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
  const { protocolRoot: engineRoot } = await resolveProtocolRoot(process.cwd(), engineConfigLoader, tempGitClient);

  // 3. Load Protocol Configuration if a separate dir is provided (e.g. .lore)
  let config = await engineConfigLoader.loadForPath(engineRoot || process.cwd());
  let protocolRoot = engineRoot;

  if (options.protocolDirName && options.protocolDirName !== options.engineDirName) {
    const protocolConfigLoader = new ConfigLoader(
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
  
  // Generic scope check - can be improved to be non-lore-specific
  const isScoped = false; 

  const atomCache: IAtomCache = new AtomCache(
    join(protocolRoot || process.cwd(), options.engineDirName, CACHE_DIR, ATOM_CACHE_DIR),
  );

  const queryCache: IQueryCache = new QueryCache(
    join(protocolRoot || process.cwd(), options.engineDirName, CACHE_DIR, QUERY_CACHE_DIR),
    config.cli.queryCachePruneThreshold || DEFAULT_CACHE_PRUNE_THRESHOLD,
  );

  const primaryProtocol: IProtocol | undefined = protocolRegistry.getAll()[0];

  const atomRepository = new AtomRepository(
    gitClient,
    trailerParser,
    primaryProtocol as any,
    protocolRegistry,
    searchFilter,
    atomCache,
    queryCache,
    isScoped,
  );

  const idGenerator = new IdGenerator(primaryProtocol as any);
  const supersessionResolver = new SupersessionResolver(primaryProtocol as any);
  const stalenessDetector = new StalenessDetector(gitClient, config, primaryProtocol as any);
  const commitBuilder = new CommitBuilder(trailerParser, idGenerator, config, protocolRegistry);
  const squashMerger = new SquashMerger(idGenerator, primaryProtocol as any);
  const validator = new Validator(trailerParser, atomRepository, config, primaryProtocol as any);
  const prompt = new TerminalPrompt();
  const commitInputResolver = new CommitInputResolver(prompt, protocolRegistry);
  const headIdReader = new HeadIdReader(gitClient, trailerParser, protocolRegistry);

  // 7. Formatter factory
  let cachedFormatter: IOutputFormatter | null = null;
  const getFormatter = (): IOutputFormatter => {
    if (cachedFormatter !== null) {
      return cachedFormatter;
    }
    const opts = program.opts();
    const isJson = opts.json || opts.format === 'json';

    if (isJson) {
      cachedFormatter = new JsonFormatter(protocolRegistry);
    } else {
      cachedFormatter = new TextFormatter(protocolRegistry, {
        color: opts.color !== false && (process.stdout.isTTY ?? false),
      });
    }
    return cachedFormatter;
  };

  // 8. Dependency bags
  const sharedDeps = {
    atomRepository,
    gitClient,
    supersessionResolver,
    pathResolver,
    getFormatter,
    config,
    protocol: primaryProtocol,
  };

  // Hook to ensure a protocol exists before running commands that require one
  program.hook('preAction', (thisCommand) => {
    const whitelist = ['cache', 'init', 'config', 'doctor'];
    if (whitelist.includes(thisCommand.name())) return;
    
    if (!primaryProtocol) {
      console.error('fatal: At least one protocol must be registered to run this command.');
      process.exit(1);
    }
  });

  // 9. Register core commands
  registerWhyCommand(program, {
    atomRepository,
    gitClient,
    pathResolver,
    getFormatter,
    protocol: primaryProtocol as any,
  });

  registerSearchCommand(program, {
    ...sharedDeps,
    searchFilter,
    protocol: primaryProtocol as any,
  });

  registerLogCommand(program, sharedDeps);

  registerStaleCommand(program, {
    ...sharedDeps,
    stalenessDetector,
  });

  registerTraceCommand(program, {
    atomRepository,
    gitClient,
    getFormatter,
    protocol: primaryProtocol as any,
  });

  registerCommitCommand(program, {
    commitBuilder,
    gitClient,
    commitInputResolver,
    headIdReader,
    getFormatter,
    config,
    protocol: primaryProtocol as any,
    protocolRegistry,
    trailerParser,
  });

  registerValidateCommand(program, {
    validator,
    gitClient,
    getFormatter,
    protocol: primaryProtocol as any,
  });

  registerSquashCommand(program, {
    atomRepository,
    squashMerger,
    getFormatter,
  });

  registerCacheCommand(program, {
    getFormatter,
    cacheDir: join(protocolRoot || process.cwd(), options.engineDirName, CACHE_DIR),
  });

  registerConfigCommand(program, {
    configLoader: engineConfigLoader,
    getFormatter,
    protocol: primaryProtocol as any,
  });

  registerDoctorCommand(program, {
    atomRepository,
    configLoader: engineConfigLoader,
    gitClient,
    getFormatter,
    protocol: primaryProtocol as any,
  });

  return { program, getFormatter, sharedDeps, config };
}

/**
 * Final execution helper
 */
export async function execute(program: Command, getFormatter: () => IOutputFormatter, config: Config) {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof ProtocolError || error instanceof ValidationError || error instanceof GitError) {
      const formatter = getFormatter();
      const messages = (error instanceof ValidationError)
        ? error.issues
        : [{ severity: 'error', message: (error as Error).message }];
      
      console.error(formatter.formatError(error.exitCode || 1, messages as any));
      process.exit(error.exitCode || 1);
    } else if (error instanceof Error) {
      const format = program.opts().json ? 'json' : 'text';
      if (format === 'json') {
        console.error(JSON.stringify({
          version: '1.0',
          error: true,
          code: 1,
          messages: [{ severity: 'error', message: error.message }],
        }, null, 2));
      } else {
        console.error(`error: ${error.message}`);
      }
      process.exit(1);
    }
  }
}
