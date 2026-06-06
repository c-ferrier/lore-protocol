// --- Domain Models & Semantic Types ---
export { ProtocolMap, type ProtocolName } from './core/models/protocol-map.js';

// --- Domain Types (Explicit Named Exports to prevent circular shadowing) ---
export type { CommitInput } from './core/types/commit.js';
export type { 
    EngineConfig, 
    StaleIfCondition,
    TrailerDefinition,
    TrailerUiColor, 
    TrailerUiKind, 
    ValueDefinition} from './core/types/config.js';
export type { 
    Atom, 
    HierarchicalTrailers,
    ProtocolState, 
    StaleReason,
    StaleSignal,
    SupersessionStatus,
    Trailers} from './core/types/domain.js';
export type { 
    CommitValidationResult, 
    DoctorCheck,
    FormattableConfigResult,
    FormattableDoctorResult,
    FormattableQueryResult,
    FormattableStalenessResult,
    FormattableTraceResult,
    FormattableTrailerDefinition,
    FormattableValidationResult,
    QueryMeta,
    QueryResult, 
    ValidationIssue} from './core/types/output.js';
export type { IIdentityResolver,ProtocolContext, ProtocolDefinition } from './core/types/protocol-definition.js';
export type { 
    FilterOperator,
    QualifiedFilter, 
    QueryIdentity, 
    QueryTargetAST, 
    SearchOptions} from './core/types/query.js';

// --- Primary Public Interfaces ---
export type { BlameLine,CommitResult, IGitClient, RawCommit } from './interfaces/git-client.js';
export type { ILogger } from './interfaces/logger.js';
export { LogLevel } from './interfaces/logger.js';
export type { ErrorMessage,IOutputFormatter } from './interfaces/output-formatter.js';

// --- Pure Logic Modules (@experimental) ---
// Explicitly export key functions to provide a stable surface and avoid cycle noise
export { formatCommit, validateFormatting } from './core/logic/commit-formatting.js';
export { filterAtoms, resolveFilters, resolveFilterStrings } from './core/logic/filtering.js';
export { extractReferenceIds,hydrateAtoms } from './core/logic/hydration.js';
export { generateId } from './core/logic/identity.js';
export { normalizeTrailers } from './core/logic/normalization.js';
export { authorizeKey,getQualifiedKey, isBucketOwner, ownsKey } from './core/logic/ownership.js';
export { normalizePathToRoot as resolvePath } from './core/logic/path-resolution.js';
export { 
    createProtocolContext,
    getAuthorizedKeys,
    getFormattableDefinitions,
    getListKeys,
    getReferenceKeys,
    getScalarKeys,
    isCoreTrailer} from './core/logic/protocols.js';
export { 
    createQueryTarget, 
    createTargetFromIdentities, 
    getCacheFingerprint, 
    getGitBlameArgs, 
    getGitLogArgs, 
    isBlameTarget} from './core/logic/query-targets.js';
export { squashAtoms } from './core/logic/squashing.js';
export { evaluateAgeSignal, evaluateDriftSignal } from './core/logic/staleness.js';
export { filterActiveAtoms,resolveSupersession } from './core/logic/supersession.js';
export { parseTrailers, serializeTrailers } from './core/logic/trailers.js';
export { resolveProtocolRoot as resolveGitRoot } from './shell/fs/root-resolver.js';

// --- Orchestrating Services (Runtime) ---
export { InMemoryLogger } from './services/in-memory-logger.js';
export { ProtocolRegistry } from './services/protocol-registry.js';
export { 
    claimsTrailers, 
    getDiscoveryPatterns, 
    getSearchPatterns, 
    matchesFilters} from './shell/git/protocol-query-adapter.js';

// --- CLI Commands & Adapters ---
export { execute,runCli } from './index-impl.js';
export { EngineBootstrapper, type EngineOptions } from './services/engine-bootstrapper.js';

// --- Command Toolkit (For Wrappers/CLI) ---
export { mergeOptions } from './cli/commands/helpers/merge-options.js';
export { addPathQueryOptions, executePathQuery, type PathQueryCommandOptions,type PathQueryDeps } from './cli/commands/helpers/path-query.js';
export { executeEngineInit } from './cli/commands/init.js';

// --- Internal Utilities (Exposed for Power Users) ---
export { camelCase, slugify, snakeCase } from './core/logic/string.js';
export { checkForUpdates } from './core/logic/update-check.js';
export { TerminalPrompt } from './cli/io/terminal-prompt.js';
export { 
    getEnginePackageName, 
    getEnginePublishedVersion, 
    getEngineVersion } from './core/logic/version.js';

export { DEFAULT_ENGINE_CONFIG } from './defaults.js';
export { 
    ENGINE_CONFIG_FILENAME, 
    ENGINE_DIR_NAME, 
    GLOBAL_CACHE_KEY, 
    TRAILER_UI_COLORS,
    TRAILER_UI_KINDS} from './util/constants.js';
export { ConfigurationError,ProtocolError } from './util/errors.js';
