import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { vi } from 'vitest';
import { type ILogger, LogLevel } from '../../../src/engine/interfaces/logger.js';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { ProtocolLoader } from '../../../src/engine/services/protocol/protocol-loader.js';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { SearchFilter } from '../../../src/engine/services/search-filter.js';
import { PathResolver } from '../../../src/engine/services/path-resolver.js';
import { TrailerParser } from '../../../src/engine/services/trailer-parser.js';
import { NullAtomCache } from '../../../src/engine/services/atom-cache.js';
import { NullQueryCache } from '../../../src/engine/services/query-cache.js';
import { InMemoryLogger } from '../../../src/engine/services/in-memory-logger.js';
import { Validator } from '../../../src/engine/services/validator.js';
import { StalenessDetector } from '../../../src/engine/services/staleness-detector.js';

import type { ProtocolDefinition } from '../../../src/engine/interfaces/protocol-definition.js';
import type { EngineConfig, ProtocolConfig, TrailerUiKind, TrailerUiColor, TrailerDefinition } from '../../../src/engine/types/config.js';
import type { RawCommit, IGitClient } from '../../../src/engine/interfaces/git-client.js';
import type { Atom, Trailers, HierarchicalTrailers } from '../../../src/engine/types/domain.js';
import type { IOutputFormatter } from '../../../src/engine/interfaces/output-formatter.js';

/**
 * MOCK: Key for the standard Mock protocol ID.
 */
export const MOCK_ID_KEY = 'Mock-id';

/**
 * Mock logger for testing.
 */
export const MockLogger = InMemoryLogger;

/**
 * A generic mock configuration for engine-level unit testing.
 */
export const MOCK_ENGINE_DIR = '.mock-engine';

/**
 * Helper to ensure a clean engine directory for tests.
 */
export function assertIsolatedEngine(dir: string = MOCK_ENGINE_DIR) {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

export const MOCK_CONFIG: EngineConfig = {
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
    updateCheck: false,
    cache: true,
    queryCache: true,
    queryCachePruneThreshold: 100,
  },
  protocols: {},
};

/**
 * A standard protocol configuration for unit tests.
 */
export const MOCK_PROTOCOL_CONFIG: ProtocolConfig = {
  version: '1.0',
  strict: false,
  permissive: true,
  trailers: {},
};

/**
 * MOCK: A generic root, permissive protocol (Engine Default).
 */
export const MOCK_PROTOCOL_DEFINITION: ProtocolDefinition = {
  name: 'Mock',
  version: '1.0',
  namespace: '', // Root namespace
  strict: false,
  permissive: true,
  identityKey: MOCK_ID_KEY,
  trailers: {
    [MOCK_ID_KEY]: {
      description: 'Stable identity.',
      multivalue: false,
      validation: 'pattern',
      pattern: '^[0-9a-f]{8}$',
      generator: 'hex8',
      required: true,
      isCore: true,
      ui: { kind: 'identity' as TrailerUiKind, color: 'dim' as TrailerUiColor },
      prompt: { order: 0 }
    },
    'Constraint': {
      description: 'Test constraint.',
      multivalue: true,
      validation: 'none',
      isCore: true,
      ui: { kind: 'decision' as TrailerUiKind, color: 'cyan' as TrailerUiColor },
      prompt: { order: 100 }
    },
    'Confidence': {
      description: 'Test confidence.',
      multivalue: false,
      validation: 'values',
      isCore: true,
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
      isCore: true,
      ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
      prompt: { order: 200 }
    },
    'Supersedes': {
        description: 'Supersedes reference.',
        multivalue: true,
        validation: 'reference',
        isCore: true,
        ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
    },
    'Depends-on': {
        description: 'Dependency reference.',
        multivalue: true,
        validation: 'reference',
        isCore: true,
        ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
    },
    'Ref': {
        description: 'Generic reference.',
        multivalue: true,
        validation: 'reference',
        isCore: true,
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
  strict: false,
  permissive: true,
  identityKey: 'YAP-id',
  trailers: {
    'YAP-id': {
        description: 'YAP identity.',
        multivalue: false,
        validation: 'pattern',
        pattern: '^[0-9a-f]{8}$',
        isCore: true
    },
    'Impact': {
        description: 'YAP impact.',
        multivalue: false,
        validation: 'values',
        values: { low: { description: '' }, high: { description: '' } },
        squash: 'rank-max',
        isCore: true
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
  strict: true,
  permissive: false,
  identityKey: 'Strict-id',
  trailers: {
    'Strict-id': {
        description: 'Strict identity.',
        multivalue: false,
        validation: 'pattern',
        pattern: '^[0-9a-f]{8}$',
        isCore: true
    },
    'Required-Key': {
        description: 'Must exist.',
        multivalue: false,
        validation: 'none',
        required: true,
        isCore: true
    }
  }
};

/**
 * Helper to create a ProtocolConfig with deep partial overrides.
 */
export function makeProtocolConfig(overrides: Partial<ProtocolConfig> = {}): ProtocolConfig {
  return {
    ...MOCK_PROTOCOL_CONFIG,
    ...overrides,
    trailers: {
        ...MOCK_PROTOCOL_CONFIG.trailers,
        ...(overrides.trailers || {}),
    },
  };
}

/**
 * High-level helper to create a fully initialized Protocol instance for tests.
 */
export function makeProtocol(
    defOverrides: Partial<ProtocolDefinition> = {},
    configOverrides: Partial<ProtocolConfig> = {}
): Protocol {
    const name = defOverrides.name ?? 'Mock';
    const identityKey = defOverrides.identityKey ?? `${name}-id`;
    
    // 1. Create a FRESH baseline definition for every call to avoid test pollution.
    const baseDef: ProtocolDefinition = {
        name,
        version: '1.0',
        namespace: '',
        strict: false,
        permissive: true,
        identityKey,
        trailers: {
            ...defOverrides.trailers
        },
        ...defOverrides
    };

    // 2. Inject default identity ONLY if trailers object is empty. 
    if (Object.keys(baseDef.trailers).length === 0) {
        baseDef.trailers[identityKey] = {
            description: 'id', 
            multivalue: false, 
            validation: 'pattern', 
            pattern: '^[0-9a-f]{8}$',
            required: true, 
            isCore: true
        };
    }

    // 3. Create config with explicit overrides
    const config = makeProtocolConfig({
        strict: baseDef.strict,
        permissive: baseDef.permissive,
        ...configOverrides
    });

    // 4. Re-use the EXACT same merge logic as production via the static ProtocolLoader helper.
    const finalized = ProtocolLoader.applyOverrides([baseDef], {
        [baseDef.name]: config
    })[0];

    return new Protocol(finalized);
}

/**
 * Factory: Create a ProtocolRegistry pre-populated with protocols.
 */
export function makeProtocolRegistry(protocols: Protocol[] = []): ProtocolRegistry {
    const registry = new ProtocolRegistry();
    for (const p of protocols) {
        registry.register(p);
    }
    return registry;
}

// -----------------------------------------------------------------------------
// REAL COMPONENT FACTORIES (Real Classes, Mocked Dependencies)
// -----------------------------------------------------------------------------

/**
 * Factory: Create a fully functional AtomRepository with reasonable defaults.
 */
export function makeAtomRepository(options: {
    gitClient?: any;
    registry?: ProtocolRegistry;
    isScoped?: boolean;
    pathResolver?: PathResolver;
    searchFilter?: SearchFilter;
} = {}): AtomRepository {
    const registry = options.registry || makeProtocolRegistry([makeProtocol()]);
    const gitClient = options.gitClient || makeMockGitClient();

    return new AtomRepository(
        gitClient,
        new TrailerParser(),
        registry,
        options.searchFilter || new SearchFilter(registry),
        options.pathResolver || new PathResolver('/mock', '/mock'),
        new NullAtomCache(),
        new NullQueryCache(),
        options.isScoped ?? false
    );
}

/**
 * Factory: Create a real Validator instance with mocked dependencies.
 */
export function makeValidator(options: {
    repository?: any;
    registry?: ProtocolRegistry;
    config?: EngineConfig;
} = {}): Validator {
    const registry = options.registry || makeProtocolRegistry([makeProtocol()]);
    const repository = options.repository || makeMockAtomRepository();
    const config = options.config || MOCK_CONFIG;
    
    return new Validator(
        new TrailerParser(),
        repository,
        config,
        registry
    );
}

/**
 * Factory: Create a real StalenessDetector instance with mocked dependencies.
 */
export function makeStalenessDetector(options: {
    gitClient?: any;
    config?: EngineConfig;
    registry?: ProtocolRegistry;
} = {}): StalenessDetector {
    const registry = options.registry || makeProtocolRegistry([makeProtocol()]);
    const gitClient = options.gitClient || makeMockGitClient();
    const config = options.config || MOCK_CONFIG;

    return new StalenessDetector(gitClient, config, registry);
}

// -----------------------------------------------------------------------------
// PURE MOCK FACTORIES (Returning vi.fn() objects)
// -----------------------------------------------------------------------------

/**
 * Factory: Create a mock GitClient with all methods as vi.fn().
 */
export function makeMockGitClient(overrides: any = {}): any {
    return {
        log: vi.fn(async () => []),
        blame: vi.fn(async () => []),
        commit: vi.fn(async () => ({ hash: 'abc123', success: true, message: 'Commit created', rawMessage: '...' })),
        hasStagedChanges: vi.fn(async () => true), // Default to true for commit tests
        getRepoRoot: vi.fn(async () => '/mock-repo'),
        isInsideRepo: vi.fn(async () => true),
        getFilesChanged: vi.fn(async () => new Map()),
        countCommitsSince: vi.fn(async () => 0),
        countAllCommits: vi.fn(async () => 0),
        resolveRef: vi.fn(async () => 'head-hash'),
        getHeadMessage: vi.fn(async () => 'message'),
        listTrackedFiles: vi.fn(async () => []),
        resolveDate: vi.fn(async (d: string) => {
            const date = new Date(d);
            return isNaN(date.getTime()) ? null : date;
        }),
        ...overrides
    };
}

/**
 * Factory: Create a mock AtomRepository with all methods as vi.fn().
 */
export function makeMockAtomRepository(overrides: any = {}): any {
    return {
        find: vi.fn(async () => []),
        findById: vi.fn(async () => null),
        findByIds: vi.fn(async () => []),
        findByCommitHash: vi.fn(async () => null),
        findByRange: vi.fn(async () => []),
        findByScope: vi.fn(async () => []),
        findByLineRange: vi.fn(async () => []),
        resolveFollowLinks: vi.fn(async (atoms) => [...atoms]),
        ...overrides
    };
}

/**
 * Factory: Create a mock SupersessionResolver with all methods as vi.fn().
 */
export function makeMockSupersessionResolver(overrides: any = {}): any {
    return {
        resolveAll: vi.fn(() => new Map()),
        filterActive: vi.fn((atoms) => atoms),
        ...overrides
    };
}

/**
 * Factory: Create a mock CommitBuilder.
 */
export function makeMockCommitBuilder(overrides: any = {}): any {
    return {
        build: vi.fn(() => ({ message: 'built', protocols: { mock: { id: 'a1b2c3d4', version: '1.0' } } })),
        validate: vi.fn(() => []), // Must return empty array for success
        ...overrides
    };
}

/**
 * Factory: Create a mock CommitInputResolver.
 */
export function makeMockInputResolver(overrides: any = {}): any {
    return {
        resolve: vi.fn(async (opts) => ({ 
            subject: opts.subject || 'test',
            body: opts.body || '',
            trailers: opts.trailers || {}
        })),
        ...overrides
    };
}

/**
 * Factory: Create a mock HeadIdReader.
 */
export function makeMockHeadIdReader(overrides: any = {}): any {
    return {
        read: vi.fn(async () => null),
        readIds: vi.fn(async () => ({})),
        ...overrides
    };
}

/**
 * Factory: Create a mock ConfigLoader.
 */
export function makeMockConfigLoader(overrides: any = {}): any {
    return {
        resolveRoot: vi.fn(async () => '/mock-repo'),
        findConfigPath: vi.fn(async () => '/mock-repo/.atom/config.toml'),
        load: vi.fn(async () => MOCK_CONFIG),
        ...overrides
    };
}

/**
 * Factory: Create a mock Prompt.
 */
export function makeMockPrompt(overrides: any = {}): any {
    return {
        confirm: vi.fn(async () => true),
        askText: vi.fn(async () => ''),
        askChoice: vi.fn(async () => ''),
        askMultiSelect: vi.fn(async () => []),
        ...overrides
    };
}

/**
 * Factory: Create a mock OutputFormatter.
 */
export function makeMockFormatter(overrides: any = {}): any {
    return {
        formatQueryResult: vi.fn(() => ''),
        formatValidationResult: vi.fn(() => ''),
        formatStalenessResult: vi.fn(() => ''),
        formatTraceResult: vi.fn(() => ''),
        formatDoctorResult: vi.fn(() => ''),
        formatSuccess: vi.fn(() => ''),
        formatError: vi.fn(() => ''),
        formatConfig: vi.fn(() => ''),
        ...overrides
    };
}

// -----------------------------------------------------------------------------
// DOMAIN OBJECT FACTORIES
// -----------------------------------------------------------------------------

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
    hash: options.hash ?? 'abc1234567890',
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
export function makeAtom(overrides: Partial<Atom & { trailers: Trailers; id: string }> = {}): Atom {
  const id = overrides.id ?? 'a1b2c3d4';
  const trailers = overrides.trailers || { [MOCK_ID_KEY]: [id] };

  const protocols = overrides.protocols ?? new Map([
    ['mock', {
      trailers,
      unauthorized: {}
    }]
  ]);

  return {
    commitHash: overrides.commitHash ?? 'abc12345',
    date: overrides.date ?? new Date('2025-01-15T10:00:00Z'),
    author: overrides.author ?? 'dev@example.com',
    subject: overrides.subject ?? 'feat: test subject',
    body: overrides.body ?? 'Test body.',
    filesChanged: overrides.filesChanged ?? ['src/main.ts'],
    protocols,
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
