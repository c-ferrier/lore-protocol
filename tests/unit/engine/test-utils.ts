import { existsSync } from 'node:fs';
import { type ILogger, LogLevel } from '../../../src/engine/interfaces/logger.js';
import { Protocol } from '../../../src/engine/services/protocol.js';
import type { ProtocolDefinition } from '../../../src/engine/interfaces/protocol-definition.js';
import type { EngineConfig, ProtocolConfig, TrailerUiKind, TrailerUiColor } from '../../../src/engine/types/config.js';
import type { RawCommit } from '../../../src/engine/interfaces/git-client.js';
import type { Atom, Trailers, HierarchicalTrailers } from '../../../src/engine/types/domain.js';
import { InMemoryLogger } from '../../../src/engine/services/in-memory-logger.js';

/**
 * Mock logger for testing.
 * Captures all logs in a shared history array to preserve ordering across children.
 */
export const MockLogger = InMemoryLogger;

/**
 * A generic mock configuration for engine-level unit testing.
 */
export const MOCK_ENGINE_DIR = '.mock-engine';

export function assertIsolatedEngine(dir: string = MOCK_ENGINE_DIR) {
  expect(existsSync(dir), `Engine directory ${dir} should not exist in test environment`).toBe(false);
}

export const MOCK_CONFIG: EngineConfig = {
  validation: {
    strict: false,
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
    updateCheck: false,
    cache: true,
    queryCache: true,
    queryCachePruneThreshold: 100,
  },
};

/**
 * A standard protocol configuration for unit tests.
 */
export const MOCK_PROTOCOL_CONFIG: ProtocolConfig = {
  version: '1.0',
  trailers: {
    definitions: {},
    permissive: true,
  },
};

/**
 * Helper to create a ProtocolConfig with deep partial overrides.
 */
export function makeProtocolConfig(overrides: Partial<ProtocolConfig> = {}): ProtocolConfig {
  return {
    version: overrides.version ?? MOCK_PROTOCOL_CONFIG.version,
    trailers: {
        ...MOCK_PROTOCOL_CONFIG.trailers,
        ...(overrides.trailers || {}),
    },
  };
}

/**
 * Helper to create a ProtocolDefinition with sensible defaults.
 * If no trailers are provided, it automatically adds a standard hex8 identity key.
 */
export function makeProtocolDefinition(overrides: Partial<ProtocolDefinition> = {}): ProtocolDefinition {
  const name = overrides.name ?? 'Mock';
  const identityKey = overrides.identityKey ?? `${name}-id`;
  
  const defaultTrailers: Record<string, any> = {
    [identityKey]: {
      description: 'Identity.',
      multivalue: false,
      validation: 'pattern',
      pattern: '^[0-9a-f]{8}$',
      generator: 'hex8',
      ui: { kind: 'identity', color: 'dim' },
      required: true,
    }
  };

  return {
    name,
    version: overrides.version ?? '1.0',
    namespace: overrides.namespace ?? '',
    identityKey,
    trailers: {
      ...defaultTrailers,
      ...overrides.trailers,
    },
    ...overrides,
  } as ProtocolDefinition;
}

/**
 * High-level helper to create a fully initialized Protocol instance for tests.
 */
export function makeProtocol(
    defOverrides: Partial<ProtocolDefinition> = {},
    configOverrides: Partial<ProtocolConfig> = {}
): Protocol {
    const def = makeProtocolDefinition(defOverrides);
    const config = makeProtocolConfig(configOverrides);
    return new Protocol(def, config);
}

/**
 * MOCK: A generic root, permissive protocol (Engine Default).
 */
export const MOCK_PROTOCOL_DEFINITION: ProtocolDefinition = {
  name: 'Mock',
  version: '1.0',
  namespace: '', // Root namespace
  identityKey: 'Mock-id',
  trailers: {
    'Mock-id': {
      description: 'Stable identity.',
      multivalue: false,
      validation: 'pattern',
      pattern: '^[0-9a-f]{8}$',
      generator: 'hex8',
      required: true,
      ui: { kind: 'identity' as TrailerUiKind, color: 'dim' as TrailerUiColor },
      prompt: { order: 0 }
    },
    'Constraint': {
      description: 'Test constraint.',
      multivalue: true,
      validation: 'none',
      ui: { kind: 'decision' as TrailerUiKind, color: 'cyan' as TrailerUiColor },
      prompt: { order: 100 }
    },
    'Confidence': {
      description: 'Test confidence.',
      multivalue: false,
      validation: 'values',
      values: {
        low: { description: 'Low' },
        medium: { description: 'Medium' },
        high: { description: 'High' }
      },
      ui: { kind: 'risk' as TrailerUiKind, color: 'cyan' as TrailerUiColor },
      squash: 'rank-min',
      prompt: { order: 120 }
    },
    'Related': {
      description: 'Related reference.',
      multivalue: true,
      validation: 'reference',
      ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
      prompt: { order: 200 }
    },
    'Supersedes': {
        description: 'Supersedes reference.',
        multivalue: true,
        validation: 'reference',
        ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
    },
    'Depends-on': {
        description: 'Dependency reference.',
        multivalue: true,
        validation: 'reference',
        ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
    },
    'Ref': {
        description: 'Generic reference.',
        multivalue: true,
        validation: 'reference',
        ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
    }
  }
};

/**
 * YAP: Yet Another Protocol (Namespaced, Permissive).
 */
export const YAP_PROTOCOL_DEFINITION: ProtocolDefinition = {
  name: 'YAP',
  version: '2.0',
  namespace: 'yap',
  identityKey: 'YAP-id',
  trailers: {
    'YAP-id': {
        description: 'YAP identity.',
        multivalue: false,
        validation: 'pattern',
        pattern: '^[0-9a-f]{8}$',
    },
    'Impact': {
        description: 'YAP impact.',
        multivalue: false,
        validation: 'values',
        values: { low: { description: '' }, high: { description: '' } },
        squash: 'rank-max'
    }
  }
};

/**
 * STRICT: A namespaced, non-permissive protocol.
 */
export const STRICT_PROTOCOL_DEFINITION: ProtocolDefinition = {
  name: 'Strict',
  version: '1.0',
  namespace: 'st',
  identityKey: 'Strict-id',
  trailers: {
    'Strict-id': {
        description: 'Strict identity.',
        multivalue: false,
        validation: 'pattern',
        pattern: '^[0-9a-f]{8}$',
    },
    'Required-Key': {
        description: 'Must exist.',
        multivalue: false,
        validation: 'none',
        required: true
    }
  }
};

/**
 * FACTORY: Create a RawCommit for testing.
 */
export function makeRawCommit(options: {
  hash?: string;
  date?: string;
  author?: string;
  subject?: string;
  body?: string;
  trailers?: string;
} = {}): RawCommit {
  return {
    hash: options.hash ?? 'abc12345',
    date: options.date ?? '2025-01-15T10:00:00Z',
    author: options.author ?? 'dev@example.com',
    subject: options.subject ?? 'feat: test subject',
    body: options.body ?? 'Test body.',
    trailers: options.trailers ?? 'Mock-id: a1b2c3d4',
  };
}

/**
 * FACTORY: Create an Atom for testing.
 */
export function makeAtom(overrides: Partial<Atom> = {}): Atom {
  return {
    commitHash: overrides.commitHash ?? 'abc12345',
    date: overrides.date ?? new Date('2025-01-15T10:00:00Z'),
    author: overrides.author ?? 'dev@example.com',
    subject: overrides.subject ?? 'feat: test subject',
    body: overrides.body ?? 'Test body.',
    filesChanged: overrides.filesChanged ?? ['src/main.ts'],
    protocols: overrides.protocols ?? new Map([
      ['mock', {
        name: 'Mock',
        version: '1.0',
        identityKey: 'Mock-id',
        trailers: { 'Mock-id': ['a1b2c3d4'] },
        unauthorized: {}
      }]
    ]),
  };
}

/**
 * FACTORY: Create a Trailers object for testing.
 */
export function makeTrailers(overrides: Partial<Trailers> = {}): Trailers {
  return {
    'Mock-id': overrides['Mock-id'] ?? ['a1b2c3d4'],
    Constraint: overrides.Constraint ?? [],
    Confidence: overrides.Confidence ?? [],
    Related: overrides.Related ?? [],
    Ref: overrides.Ref ?? [],
    Supersedes: overrides.Supersedes ?? [],
    'Depends-on': overrides['Depends-on'] ?? [],
    ...overrides,
  };
}

/**
 * FACTORY: Create a HierarchicalTrailers object for testing.
 */
export function makeHierarchicalTrailers(overrides: Partial<HierarchicalTrailers> = {}): HierarchicalTrailers {
    return {
        '': makeTrailers(overrides[''] ?? {}),
        ...overrides
    };
}
