import { Command } from 'commander';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import type { IGitClient } from './interfaces/git-client.js';
import type { IAtomCache } from './interfaces/atom-cache.js';
import type { IQueryCache } from './interfaces/query-cache.js';
import type { IOutputFormatter } from './interfaces/output-formatter.js';
import type { Config } from './types/config.js';
import type { ProtocolDefinition } from './interfaces/protocol-definition.js';

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
  readonly configDirName: string;
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

  // 1. Load Configuration (Temporary bootstrap)
  const configLoader = new ConfigLoader(
    options.configDirName,
    options.configFileName,
    options.defaultConfig
  );

  // 2. Resolve Project Root
  const tempGitClient = new GitClient(process.cwd());
  const { protocolRoot } = await resolveProtocolRoot(process.cwd(), configLoader, tempGitClient);

  // 3. Final Configuration
  let config: Config;
  try {
    const loaded = protocolRoot ? await configLoader.loadForPath(protocolRoot) : null;
    config = loaded || options.defaultConfig;
  } catch (err) {
    console.error(
      `error: Failed to load configuration: ${err instanceof Error ? err.message : String(err)}`,
    );
    config = options.defaultConfig;
  }

  // 4. Global Options
  const packageJson = JSON.parse(readFileSync(options.packageJsonPath, 'utf-8'));

  program
    .name(options.binaryName)
    .version(getDisplayVersion(packageJson.version))
    .description(options.description)
    .option('--json', 'Output results in JSON format')
    .option('--no-cache', 'Bypass local atom cache')
    .option('--no-color', 'Disable terminal colors')
    .option('-C, --context <path>', 'Run in the context of a specific directory')
    .option('--format <type>', 'Output format (text, json)', 'text');

  // 5. Create primary services with resolved root context
  const gitClient: IGitClient = new GitClient(protocolRoot);
  const protocolRegistry = new ProtocolRegistry();
  
  // Register provided protocols
  for (const def of options.protocols) {
    protocolRegistry.register(new Protocol(def, config));
  }
  
  // We use the first protocol as the "primary" for certain context-less ops if needed
  // In Lore case, it's the only one.
  const primaryProtocol = protocolRegistry.getAll()[0];
  if (!primaryProtocol) {
    throw new Error('At least one protocol must be registered.');
  }

  const trailerParser = new TrailerParser();
  const pathResolver = new PathResolver(process.cwd(), protocolRoot);
  const idGenerator = new IdGenerator(primaryProtocol);
  const searchFilter = new SearchFilter(protocolRegistry);
  
  // Generic scope check - can be improved to be non-lore-specific
  // For now, Lore wrapper can handle its specific scope check before calling runCli if needed
  const isScoped = false; 

  const atomCache: IAtomCache = new AtomCache(
    join(protocolRoot || process.cwd(), options.configDirName, CACHE_DIR, ATOM_CACHE_DIR),
  );

  const queryCache: IQueryCache = new QueryCache(
    join(protocolRoot || process.cwd(), options.configDirName, CACHE_DIR, QUERY_CACHE_DIR),
    config.cli.queryCachePruneThreshold || DEFAULT_CACHE_PRUNE_THRESHOLD,
  );

  const atomRepository = new AtomRepository(
    gitClient,
    trailerParser,
    primaryProtocol,
    protocolRegistry,
    searchFilter,
    atomCache,
    queryCache,
    isScoped,
  );

  const supersessionResolver = new SupersessionResolver(primaryProtocol);
  const stalenessDetector = new StalenessDetector(gitClient, config, primaryProtocol);
  const commitBuilder = new CommitBuilder(trailerParser, idGenerator, config, primaryProtocol);
  const squashMerger = new SquashMerger(idGenerator, primaryProtocol);
  const validator = new Validator(trailerParser, atomRepository, config, primaryProtocol);
  const prompt = new TerminalPrompt();
  const commitInputResolver = new CommitInputResolver(prompt, primaryProtocol);
  const headIdReader = new HeadIdReader(gitClient, trailerParser, primaryProtocol);

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

  // 9. Register core commands
  registerWhyCommand(program, {
    atomRepository,
    gitClient,
    pathResolver,
    getFormatter,
    protocol: primaryProtocol,
  });

  registerSearchCommand(program, {
    ...sharedDeps,
    searchFilter,
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
    protocol: primaryProtocol,
  });

  registerCommitCommand(program, {
    commitBuilder,
    gitClient,
    commitInputResolver,
    headIdReader,
    getFormatter,
    config,
    protocol: primaryProtocol,
    protocolRegistry,
    trailerParser,
  });

  registerValidateCommand(program, {
    validator,
    gitClient,
    getFormatter,
  });

  registerSquashCommand(program, {
    atomRepository,
    squashMerger,
    getFormatter,
  });

  registerCacheCommand(program, {
    getFormatter,
    cacheDir: join(protocolRoot || process.cwd(), options.configDirName, CACHE_DIR),
  });

  registerConfigCommand(program, {
    configLoader,
    getFormatter,
    protocol: primaryProtocol,
  });

  registerDoctorCommand(program, {
    atomRepository,
    configLoader,
    gitClient,
    protocol: primaryProtocol,
  });

  // Return program and shared deps so wrappers can add more commands
  return { program, getFormatter, sharedDeps, config };
}

/**
 * Final execution helper
 */
export async function execute(program: Command, getFormatter: () => IOutputFormatter, config: Config) {
  try {
    if (shouldCheckForUpdate(config.cli.updateCheck)) {
      // update check logic
    }
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
