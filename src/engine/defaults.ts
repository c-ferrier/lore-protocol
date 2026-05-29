import type { EngineConfig } from './types/config.js';

/**
 * Baseline host-level configuration for the Decision Atom Engine.
 */
export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  validation: {
    maxMessageLines: 50,
    subjectMaxLength: 72,
  },
  stale: {
    olderThan: '6m',
    driftThreshold: 20,
  },
  output: {
    defaultFormat: 'text',
  },
  follow: {
    maxDepth: 3,
  },
  cli: {
    updateCheck: true,
    cache: true,
    queryCache: true,
    queryCachePruneThreshold: 100,
  },
};
