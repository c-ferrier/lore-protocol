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
import { DEFAULT_CACHE_PRUNE_THRESHOLD, CACHE_DIR, ATOM_CACHE_DIR, QUERY_CACHE_DIR, PROTOCOLS_DIR_NAME } from './util/constants.js';
import { ProtocolHydrator } from './services/protocol-hydrator.js';
import { StalenessDetector } from './services/staleness-detector.js';
import { CommitBuilder } from './services/commit-builder.js';
import { SquashMerger } from './services/squash-merger.js';
import { Validator } from './services/validator.js';
import { TerminalPrompt } from './services/terminal-prompt.js';
import { CommitInputResolver } from './services/commit-input-resolver.js';
import { HeadIdReader } from './services/head-id-reader.js';
import { resolveProtocolRoot } from './services/root-resolver.js';
import { DynamicProtocolLoader } from './services/protocol-loader.js';
import { ProtocolLoader } from './services/protocol/protocol-loader.js';
import { getEngineVersion } from './util/version.js';
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

import type { IGitClient } from './interfaces/git-client.js';
import type { IProtocol } from './interfaces/protocol.js';
import type { ProtocolDefinition } from './interfaces/protocol-definition.js';
import type { EngineConfig, ProtocolConfig } from './types/config.js';
import type { IAtomCache } from './interfaces/atom-cache.js';
import type { IQueryCache } from './interfaces/query-cache.js';
import type { IOutputFormatter } from './interfaces/output-formatter.js';

import { EngineBootstrapper, type EngineOptions } from './services/engine-bootstrapper.js';

export { EngineBootstrapper, type EngineOptions };

/**
 * Generic bootstrap for the Decision Engine CLI.
 */
export async function runCli(options: EngineOptions) {
  const bootstrapper = new EngineBootstrapper(options);
  return bootstrapper.bootstrap();
}

/**
 * Executes the configured commander program.
 */
export async function execute(program: any, getFormatter: () => any, config: any) {
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

