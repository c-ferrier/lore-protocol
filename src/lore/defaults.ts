import { DEFAULT_ENGINE_CONFIG } from '../engine/defaults.js';

/** Filesystem paths for Lore protocol configuration */
export const LORE_CONFIG_DIR = '.lore';
export const LORE_CONFIG_FILENAME = 'config.toml';

/**
 * The formal TypeScript structure for a Lore 0.5.0 configuration file.
 */
export interface Lore050Config {
  protocol?: {
    version?: string;
  };
  trailers?: {
    required?: string[];
    custom?: string[];
  };
  validation?: {
    strict?: boolean;
    max_message_lines?: number;
    intent_max_length?: number;
  };
  stale?: {
    older_than?: string;
    drift_threshold?: number;
  };
  output?: {
    default_format?: 'text' | 'json';
  };
  follow?: {
    max_depth?: number;
  };
  cli?: {
    update_check?: boolean;
  };
}

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
 * The currently active authoritative template for fresh project initialization.
 */
export const LORE_CONFIG_TEMPLATE = LORE_050_CONFIG_TEMPLATE;

/** 
 * The current authoritative version of the Lore configuration.
 * Change this alias when moving to a new version (e.g. Lore060Config).
 */
export type LoreConfig = Lore050Config;

/**
 * Metadata for the gap detector to avoid false positives 
 * when comparing against old config files.
 * @deprecated Driven by LORE_050_CONFIG_TEMPLATE at runtime.
 */
// Removed LORE_050_EXPECTED_KEYS to avoid duplication with interface and template.

