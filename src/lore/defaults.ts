import type { Config } from '../engine/types/config.js';
import { DEFAULT_CACHE_PRUNE_THRESHOLD } from '../util/constants.js';

/** Filesystem paths for Lore protocol configuration */
export const LORE_CONFIG_DIR = '.lore';
export const LORE_CONFIG_FILENAME = 'config.toml';

/** The default configuration for the Lore protocol */
export const LORE_DEFAULT_CONFIG: Config = {
  protocol: { name: 'Lore', version: '1.0' },
  trailers: { required: [], custom: [], definitions: {}, permissive: true },
  validation: { strict: false, maxMessageLines: 50, subjectMaxLength: 72 },
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
