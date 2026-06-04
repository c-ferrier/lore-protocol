// --- Domain Models & Semantic Types ---
export { ProtocolMap, type ProtocolName } from './core/models/protocol-map.js';
export { ActiveProtocol, type ActiveTrailer } from './core/models/active-protocol.js';

// --- Domain Types (Explicit Named Exports to prevent circular shadowing) ---
export type { 
    Atom, 
    ProtocolState, 
    SupersessionStatus,
    Trailers,
    HierarchicalTrailers,
    StaleReason,
    StaleSignal
} from './core/types/domain.js';

export type { 
    EngineConfig, 
    TrailerUiKind, 
    TrailerUiColor, 
    TrailerDefinition,
    ValueDefinition,
    StaleIfCondition
} from './core/types/config.js';

export type { 
    QualifiedFilter, 
    SearchOptions, 
    FilterOperator,
    QueryTargetAST, 
    QueryIdentity 
} from './core/types/query.js';

export type { 
    QueryResult, 
    QueryMeta,
    CommitValidationResult, 
    ValidationIssue, 
    FormattableTrailerDefinition,
    FormattableQueryResult,
    FormattableValidationResult,
    FormattableStalenessResult,
    FormattableTraceResult,
    FormattableConfigResult,
    FormattableDoctorResult,
    DoctorCheck
} from './core/types/output.js';

export type { CommitInput } from './core/types/commit.js';
export type { ProtocolDefinition } from './core/types/protocol-definition.js';

// --- Primary Public Interfaces ---
export type { IGitClient, RawCommit, CommitResult, BlameLine } from './interfaces/git-client.js';
export type { ILogger } from './interfaces/logger.js';
export { LogLevel } from './interfaces/logger.js';
export type { IOutputFormatter, ErrorMessage } from './interfaces/output-formatter.js';

// --- Pure Logic Modules (@experimental) ---
// Explicitly export key functions to provide a stable surface and avoid cycle noise
export { hydrateAtoms, extractReferenceIds } from './core/logic/hydration.js';
export { resolveSupersession, filterActiveAtoms } from './core/logic/supersession.js';
export { generateId } from './core/logic/identity.js';
export { parseTrailers, serializeTrailers } from './core/logic/trailers.js';
export { filterAtoms, resolveFilters, resolveFilterStrings } from './core/logic/filtering.js';
export { squashAtoms } from './core/logic/squashing.js';
export { formatCommit, validateFormatting } from './core/logic/commit-formatting.js';
export { normalizePathToRoot as resolvePath } from './core/logic/path-resolution.js';
export { resolveProtocolRoot as resolveGitRoot } from './shell/fs/root-resolver.js';
export { 
    createQueryTarget, 
    createTargetFromIdentities, 
    getCacheFingerprint, 
    isBlameTarget, 
    getGitLogArgs, 
    getGitBlameArgs 
} from './core/logic/query-targets.js';
export { evaluateAgeSignal, evaluateDriftSignal } from './core/logic/staleness.js';

// --- Orchestrating Services (Runtime) ---
export { ProtocolRegistry } from './services/protocol-registry.js';
export { ProtocolQueryAdapter } from './shell/git/protocol-query-adapter.js';
export { InMemoryLogger } from './services/in-memory-logger.js';

// --- CLI Commands & Adapters ---
export { runCli, execute } from './index-impl.js';
export { EngineBootstrapper, type EngineOptions } from './services/engine-bootstrapper.js';

// --- Command Toolkit (For Wrappers/CLI) ---
export { executePathQuery, addPathQueryOptions, type PathQueryDeps, type PathQueryCommandOptions } from './cli/commands/helpers/path-query.js';
export { mergeOptions } from './cli/commands/helpers/merge-options.js';
export { executeEngineInit } from './cli/commands/init.js';

// --- Internal Utilities (Exposed for Power Users) ---
export { slugify, camelCase, snakeCase } from './util/string.js';
export { 
    getEngineVersion, 
    getEnginePackageName, 
    getEnginePublishedVersion 
} from './util/version.js';
export { checkForUpdates } from './util/update-check.js';
export { ProtocolError, ConfigurationError } from './util/errors.js';
export { 
    ENGINE_CONFIG_FILENAME, 
    ENGINE_DIR_NAME, 
    TRAILER_UI_KINDS, 
    TRAILER_UI_COLORS,
    GLOBAL_CACHE_KEY 
} from './util/constants.js';
export { DEFAULT_ENGINE_CONFIG } from './defaults.js';
