// --- Core Entry Points ---
export { runCli, execute } from './index-impl.js';
export { EngineBootstrapper, type EngineOptions } from './services/engine-bootstrapper.js';

// --- Domain Models & Semantic Types ---
export { ProtocolMap, type ProtocolName } from './util/protocol-map.js';
export * from './types/domain.js';
export * from './types/config.js';
export * from './types/query.js';
export * from './types/output.js';
export * from './types/commit.js';

// --- Primary Public Interfaces ---
export type { IGitClient } from './interfaces/git-client.js';
export type { IProtocol } from './interfaces/protocol.js';
export type { ProtocolDefinition } from './interfaces/protocol-definition.js';
export type { ILogger } from './interfaces/logger.js';
export { LogLevel } from './interfaces/logger.js';
export type { IOutputFormatter, ErrorMessage } from './interfaces/output-formatter.js';

// --- Orchestrating Services (Runtime) ---
export { ProtocolRegistry } from './services/protocol-registry.js';
export { Protocol } from './services/protocol.js';
export { ProtocolHydrator } from './services/protocol-hydrator.js';
export { InMemoryLogger } from './services/in-memory-logger.js';

// --- Command Toolkit (For Wrappers/CLI) ---
export * from './commands/helpers/path-query.js';
export { mergeOptions } from './commands/helpers/merge-options.js';
export { executeEngineInit } from './commands/init.js';

// --- Base Formatters (For Extension) ---
export { TextFormatter } from './formatters/text-formatter.js';
export { JsonFormatter } from './formatters/json-formatter.js';

// --- Utilities & Constants ---
export { ProtocolError, ConfigurationError } from './util/errors.js';
export * from './util/constants.js';
export { DEFAULT_ENGINE_CONFIG } from './defaults.js';
export { slugify, camelCase, snakeCase } from './util/string.js';
export { 
    getEngineVersion, 
    getEnginePackageName, 
    getEnginePublishedVersion 
} from './util/version.js';
export { checkForUpdates } from './util/update-check.js';
