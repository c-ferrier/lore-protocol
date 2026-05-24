import type { Config } from '../types/config.js';

/** Default display limit for query results */
export const DEFAULT_QUERY_LIMIT = 20;

/** Default max git commits to scan when looking for Lore atoms */
export const DEFAULT_MAX_COMMITS = 1000;

/** Default max number of query cache entries to keep (LRU pruning threshold) */
export const DEFAULT_CACHE_PRUNE_THRESHOLD = 100;

/** The default configuration for the engine */
export const DEFAULT_CONFIG: Config = {
  protocol: { name: 'Lore', version: '1.0' },
  trailers: { required: [], custom: [], definitions: {}, permissive: true },
  validation: { strict: false, maxMessageLines: 50, intentMaxLength: 72 },
  stale: { olderThan: '6m', driftThreshold: 20 },
  output: { defaultFormat: 'text' },
  follow: { maxDepth: 3 },
  cli: { 
    updateCheck: true, 
    cache: true, 
    queryCache: true,
    queryCachePruneThreshold: DEFAULT_CACHE_PRUNE_THRESHOLD,
  },
};

/** Filesystem paths for protocol configuration */
export const CONFIG_DIR = '.lore';
export const CONFIG_FILENAME = 'config.toml';
/** Main cache directory within CONFIG_DIR */
export const CACHE_DIR = 'cache';
/** Subdirectory within CACHE_DIR used for atom metadata caching */
export const ATOM_CACHE_DIR = 'atom';
/** Subdirectory within CACHE_DIR used for query result caching */
export const QUERY_CACHE_DIR = 'query';

/** Prompt strings for interactive mode (Intent and Body only) */
export const PROMPT_STRINGS = {
  INTENT: 'Intent (why the change was made):',
  ADD_BODY: 'Add a body? (narrative context)',
  BODY_INPUT: 'Body (press Enter on empty line to finish):',
} as const;

/** Staleness detection signals */
export const STALE_SIGNAL = {
  AGE: 'age' as const,
  DRIFT: 'drift' as const,
  LOW_CONFIDENCE: 'low-confidence' as const,
  EXPIRED_HINT: 'expired-hint' as const,
  ORPHANED_DEP: 'orphaned-dep' as const,
};

/** Default batch size for parallel git file-change lookups */
export const GIT_FILES_CHANGED_BATCH_SIZE = 20;

/** Exit codes for the CLI */
export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_VALIDATION_ERROR = 1;
export const EXIT_CODE_GIT_ERROR = 2;
export const EXIT_CODE_NO_STAGED_CHANGES = 3;

/** Standard trailer UI semantic kinds */
export const TRAILER_UI_KINDS = [
  'identity',
  'risk',
  'decision',
  'evidence',
  'reference',
  'custom',
] as const;

/** Standard trailer UI colors (chalk-compatible) */
export const TRAILER_UI_COLORS = [
  'cyan',
  'magenta',
  'yellow',
  'green',
  'red',
  'dim',
] as const;

/** Identity key for the primary protocol */
export const IDENTITY_KEY = 'Lore-id';
/** 8-character hex string pattern for identities */
export const ID_PATTERN = /^[0-9a-f]{8}$/;
