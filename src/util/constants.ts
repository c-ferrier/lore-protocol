/** Default display limit for query results */
export const DEFAULT_QUERY_LIMIT = 20;

/** Default max git commits to scan when looking for protocol atoms */
export const DEFAULT_MAX_COMMITS = 1000;

/** Default max number of query cache entries to keep (LRU pruning threshold) */
export const DEFAULT_CACHE_PRUNE_THRESHOLD = 100;

/** Prompt strings for interactive mode (Subject and Body only) */
export const PROMPT_STRINGS = {
  SUBJECT: 'Subject (why the change was made):',
  ADD_BODY: 'Add a body? (narrative context)',
  BODY_INPUT: 'Body (press Enter on empty line to finish):',
} as const;

/** Staleness detection signals */
export const STALE_SIGNAL = {
  AGE: 'age' as const,
  DRIFT: 'drift' as const,
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

/** Default cache subdirectories */
export const CACHE_DIR = 'cache';
export const ATOM_CACHE_DIR = 'atom';
export const QUERY_CACHE_DIR = 'query';
