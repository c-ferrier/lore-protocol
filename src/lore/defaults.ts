import type { EngineConfig } from '../engine/types/config.js';
import { DEFAULT_CACHE_PRUNE_THRESHOLD } from '../util/constants.js';

/** Filesystem paths for Lore protocol configuration */
export const LORE_CONFIG_DIR = '.lore';
export const LORE_CONFIG_FILENAME = 'config.toml';

/**
 * The default Engine-level configuration used by the Lore CLI.
 */
export const LORE_DEFAULT_ENGINE_CONFIG: EngineConfig = {
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

/**
 * The literal TOML content for a fresh Lore 0.5.0 configuration.
 * This matches the system Lore 0.5.0 exactly.
 */
export const LORE_050_CONFIG_TEMPLATE = `[protocol]
version = "1.0"

[trailers]
required = []
custom = []

[validation]
strict = false
max_message_lines = 50
intent_max_length = 72

[stale]
older_than = "6m"
drift_threshold = 20

[output]
default_format = "text"

[follow]
max_depth = 3

[cli]
update_check = true
`;

/**
 * Metadata for the gap detector to avoid false positives 
 * when comparing against old config files.
 * This represents the STRICT 0.5.0 specification.
 */
export const LORE_050_EXPECTED_KEYS: Record<string, string[]> = {
    protocol: ['version'],
    trailers: ['required', 'custom'],
    validation: ['strict', 'max_message_lines', 'intent_max_length'],
    stale: ['older_than', 'drift_threshold'],
    output: ['default_format'],
    follow: ['max_depth'],
    cli: ['update_check'] // ONLY update_check was in 0.5.0
};

/** Re-export for compatibility during migration */
export const LORE_DEFAULT_CONFIG = {
    ...LORE_DEFAULT_ENGINE_CONFIG,
    protocol: { name: 'Lore', version: '1.0' },
    trailers: { required: [], custom: [], definitions: {}, permissive: true }
} as any;
