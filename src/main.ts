import { Command } from 'commander';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

import type { IGitClient } from './interfaces/git-client.js';
import type { IAtomCache } from './interfaces/atom-cache.js';
import type { IQueryCache } from './interfaces/query-cache.js';
import type { IOutputFormatter } from './interfaces/output-formatter.js';
import type { Config } from './types/config.js';

import { GitClient } from './services/git-client.js';
import { TrailerParser } from './services/trailer-parser.js';
import { IdGenerator } from './services/id-generator.js';
import { AtomRepository } from './services/atom-repository.js';
import { Validator } from './services/validator.js';
import { ConfigLoader } from './services/config-loader.js';
import { resolveLoreRoot } from './services/root-resolver.js';
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
import { LoreProtocolDefinition } from './protocols/lore.js';

import { TextFormatter } from './formatters/text-formatter.js';
import { JsonFormatter } from './formatters/json-formatter.js';

import { registerInitCommand } from './commands/init.js';
import { registerContextCommand } from './commands/context.js';
import { registerConstraintsCommand } from './commands/constraints.js';
import { registerDirectivesCommand } from './commands/directives.js';
import { registerTestedCommand } from './commands/tested.js';
import { registerRejectedCommand } from './commands/rejected.js';
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
  DEFAULT_CONFIG,
  CONFIG_DIR,
  CACHE_DIR,
  ATOM_CACHE_DIR,
  QUERY_CACHE_DIR,
  DEFAULT_CACHE_PRUNE_THRESHOLD,
} from './util/constants.js';
import { ProtocolError, ValidationError, GitError } from './util/errors.js';
import { TerminalPrompt } from './services/terminal-prompt.js';
import { AtomCache } from './services/atom-cache.js';
import { QueryCache } from './services/query-cache.js';
import { shouldCheckForUpdate } from './util/update-check.js';
import { getDisplayVersion } from './util/version.js';

/**
 * Main entry point for the Lore CLI.
 * Orchestrates service instantiation and command registration.
 *
 * GRASP: Controller -- handles high-level coordination of the application.
 */
async function main() {
  const program = new Command();

  // 1. Load Configuration (Temporary bootstrap)
  const configLoader = new ConfigLoader();

  // 2. Resolve Project Root
  const tempGitClient = new GitClient(process.cwd());
  const { protocolRoot } = await resolveLoreRoot(process.cwd(), configLoader, tempGitClient);

  // 3. Final Configuration
  let config: Config;
  try {
    const loaded = protocolRoot ? await configLoader.loadForPath(protocolRoot) : null;
    config = loaded || DEFAULT_CONFIG;
  } catch (err) {
    console.error(
      `error: Failed to load configuration: ${err instanceof Error ? err.message : String(err)}`,
    );
    config = DEFAULT_CONFIG;
  }

  // 4. Global Options
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
  );

  program
    .name('lore')
    .version(getDisplayVersion(packageJson.version))
    .description('Decision tracking for software engineers')
    .option('--json', 'Output results in JSON format')
    .option('--no-cache', 'Bypass local atom cache')
    .option('--no-color', 'Disable terminal colors')
    .option('-C, --context <path>', 'Run in the context of a specific directory')
    .option('--format <type>', 'Output format (text, json)', 'text');

  // 5. Create primary services with resolved root context
  const gitClient: IGitClient = new GitClient(protocolRoot);
  const protocol = new Protocol(LoreProtocolDefinition, config);
  const protocolRegistry = new ProtocolRegistry();
  protocolRegistry.register(protocol);

  const trailerParser = new TrailerParser();
  const pathResolver = new PathResolver(process.cwd(), protocolRoot);
  const idGenerator = new IdGenerator(protocol);
  const searchFilter = new SearchFilter(protocolRegistry);
  const isScoped = existsSync(join(process.cwd(), '.lore-scope'));

  const atomCache: IAtomCache = new AtomCache(
    join(protocolRoot || process.cwd(), CONFIG_DIR, CACHE_DIR, ATOM_CACHE_DIR),
  );

  const queryCache: IQueryCache = new QueryCache(
    join(protocolRoot || process.cwd(), CONFIG_DIR, CACHE_DIR, QUERY_CACHE_DIR),
    config.cli.queryCachePruneThreshold || DEFAULT_CACHE_PRUNE_THRESHOLD,
  );

  const atomRepository = new AtomRepository(
    gitClient,
    trailerParser,
    protocol,
    protocolRegistry,
    searchFilter,
    atomCache,
    queryCache,
    isScoped,
  );

  const supersessionResolver = new SupersessionResolver(protocol);
  const stalenessDetector = new StalenessDetector(gitClient, config, protocol);
  const commitBuilder = new CommitBuilder(trailerParser, idGenerator, config, protocol);
  const squashMerger = new SquashMerger(idGenerator, protocol);
  const validator = new Validator(trailerParser, atomRepository, config, protocol);
  const prompt = new TerminalPrompt();
  const commitInputResolver = new CommitInputResolver(prompt, protocol);
  const headIdReader = new HeadIdReader(gitClient, trailerParser, protocol);

  // 7. Formatter factory (reads --format/--json from program options at call time)
  // Memoized: the formatter is created once on first call and reused thereafter.
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


  // 8. Register all commands with their dependencies

  registerInitCommand(program, { getFormatter, protocolName: config.protocol.name });

  const pathQueryDeps = {
    atomRepository,
    gitClient,
    supersessionResolver,
    pathResolver,
    getFormatter,
    config,
    protocol,
  };

  registerContextCommand(program, pathQueryDeps);
  registerConstraintsCommand(program, pathQueryDeps);
  registerRejectedCommand(program, pathQueryDeps);
  registerDirectivesCommand(program, pathQueryDeps);
  registerTestedCommand(program, pathQueryDeps);

  registerWhyCommand(program, {
    atomRepository,
    gitClient,
    pathResolver,
    getFormatter,
    protocol,
  });

  registerSearchCommand(program, {
    atomRepository,
    gitClient,
    supersessionResolver,
    searchFilter,
    getFormatter,
    config,
    protocol,
  });

  registerLogCommand(program, {
    atomRepository,
    supersessionResolver,
    getFormatter,
    config,
    protocol,
  });

  registerStaleCommand(program, {
    atomRepository,
    supersessionResolver,
    stalenessDetector,
    pathResolver,
    getFormatter,
  });

  registerTraceCommand(program, {
    atomRepository,
    gitClient,
    getFormatter,
    protocol,
  });

  registerCommitCommand(program, {
    commitBuilder,
    gitClient,
    commitInputResolver,
    headIdReader,
    getFormatter,
    config,
    protocol,
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
    cacheDir: join(protocolRoot || process.cwd(), CONFIG_DIR, CACHE_DIR),
  });

  registerConfigCommand(program, {
    configLoader,
    getFormatter,
    protocol,
  });

  registerDoctorCommand(program, {
    atomRepository,
    configLoader,
    gitClient,
    protocol,
  });

  // 9. Error Handling & Execution
  try {
    // Check for updates in the background
    if (shouldCheckForUpdate(config.cli.updateCheck)) {
      // Background check omitted for now as it needs a specific implementation
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
      // For unexpected errors, use standard formatting or the text formatter fallback
      const format = program.opts().json ? 'json' : 'text';
      if (format === 'json') {
        console.error(
          JSON.stringify(
            {
              version: '1.0',
              error: true,
              code: 1,
              messages: [{ severity: 'error', message: error.message }],
            },
            null,
            2,
          ),
        );
      } else {
        console.error(`error: ${error.message}`);
      }
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
