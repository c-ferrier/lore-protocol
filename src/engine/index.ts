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
// --- Domain Types ---
export type { Atom, ProtocolState, SupersessionStatus } from './types/domain.js';
export type { IGitClient, RawCommit } from './interfaces/git-client.js';
export type { IProtocol } from './interfaces/protocol.js';
export type { ProtocolDefinition } from './interfaces/protocol-definition.js';
export type { ILogger } from './interfaces/logger.js';
export { LogLevel } from './interfaces/logger.js';
export type { IOutputFormatter, ErrorMessage } from './interfaces/output-formatter.js';

// --- Pure Logic Modules (@experimental) ---
// These modules represent the internal "Brains" of the engine.
// While they are pure and safe to use, their exact signatures are NOT 
// guaranteed by semantic versioning until Engine v1.0.
export * from './logic/hydration.js';
export * from './logic/supersession.js';
export * from './logic/identity.js';
export * from './logic/trailers.js';
export * from './logic/filtering.js';
export * from './logic/squashing.js';
export * from './logic/commit-formatting.js';

// --- Orchestrating Services (Runtime) ---
export { ProtocolRegistry } from './services/protocol-registry.js';
export { Protocol } from './services/protocol.js';
export { InMemoryLogger } from './services/in-memory-logger.js';

// --- Command Toolkit (For Wrappers/CLI) ---
export * from './commands/helpers/path-query.js';
export { mergeOptions } from './commands/helpers/merge-options.js';
export { executeEngineInit } from './commands/init.js';

// --- Formatter Toolkit (Opaque) ---
import { TextFormatter } from './formatters/text-formatter.js';
import { JsonFormatter } from './formatters/json-formatter.js';
import type { ProtocolRegistry } from './services/protocol-registry.js';
import type { IOutputFormatter } from './interfaces/output-formatter.js';

/** Factory to get standard engine behaviors without exposing base classes. */
export function createBaseFormatter(type: 'text' | 'json', registry: ProtocolRegistry, options: { color: boolean } = { color: true }): IOutputFormatter {
    return type === 'text' ? new TextFormatter(registry, options) : new JsonFormatter(registry);
}

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
