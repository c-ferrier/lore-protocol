import { existsSync, mkdirSync } from 'node:fs';
import { vi } from 'vitest';
import { Protocol } from '../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../src/engine/services/protocol-registry.js';
import { ProtocolLoader } from '../../src/engine/services/protocol/protocol-loader.js';
import { AtomRepository } from '../../src/engine/services/atom-repository.js';
import { SearchFilter } from '../../src/engine/services/search-filter.js';
import { PathResolver } from '../../src/engine/services/path-resolver.js';
import { TrailerParser } from '../../src/engine/services/trailer-parser.js';
import { NullAtomCache } from '../../src/engine/services/atom-cache.js';
import { NullQueryCache } from '../../src/engine/services/query-cache.js';
import { InMemoryLogger } from '../../src/engine/services/in-memory-logger.js';
import { Validator } from '../../src/engine/services/validator.js';
import { StalenessDetector } from '../../src/engine/services/staleness-detector.js';

import type { ProtocolDefinition } from '../../src/engine/interfaces/protocol-definition.js';
import type { EngineConfig, ProtocolConfig, TrailerUiKind, TrailerUiColor } from '../../src/engine/types/config.js';
import type { RawCommit } from '../../src/engine/interfaces/git-client.js';
import type { Atom, Trailers, HierarchicalTrailers } from '../../src/engine/types/domain.js';

/**
 * =============================================================================
 * TEST INFRASTRUCTURE CONVENTIONS
 * =============================================================================
 * 
 * 1. TEST_* (Constants): Real, valid data objects used as baselines for tests.
 * 2. make* (Real Component Factories): Returns a REAL class instance (e.g. 
 *    new Service()). Use these for Integration or System tests.
 * 3. makeMock* (Pure Mock Factories): Returns a Vitest mock object (vi.fn()). 
 *    Use these for Unit tests where you want to isolate the component.
 * =============================================================================
 */

/** Key for the standard baseline protocol ID. */
export const TEST_ID_KEY = 'Mock-id';

/** A clean directory name for engine-level unit testing. */
export const TEST_ENGINE_DIR = '.test-engine';

/** A standard, valid engine configuration. */
export const TEST_ENGINE_CONFIG: EngineConfig = {
  validation: { maxMessageLines: 50, subjectMaxLength: 72 },
  stale: { olderThan: '6m', driftThreshold: 20 },
  output: { defaultFormat: 'text' },
  follow: { maxDepth: 3 },
  cli: { updateCheck: false, cache: true, queryCache: true, queryCachePruneThreshold: 100 },
  protocols: {},
};

/** A standard, valid protocol configuration. */
export const TEST_PROTOCOL_CONFIG: ProtocolConfig = {
  version: '1.0', strict: false, permissive: true, trailers: {},
};

/** A generic root, permissive protocol schema definition. */
export const TEST_PROTOCOL_DEFINITION: ProtocolDefinition = {
  name: 'Mock',
  version: '1.0',
  namespace: '', // Root namespace
  strict: false,
  permissive: true,
  identityKey: TEST_ID_KEY,
  trailers: {
    [TEST_ID_KEY]: {
      description: 'Stable identity.', multivalue: false, validation: 'pattern',
      pattern: '^[0-9a-f]{8}$', generator: 'hex8', required: true, isCore: true,
      ui: { kind: 'identity' as TrailerUiKind, color: 'dim' as TrailerUiColor },
      prompt: { order: 0 }
    },
    'Constraint': {
      description: 'Test constraint.', multivalue: true, validation: 'none', isCore: true,
      ui: { kind: 'decision' as TrailerUiKind, color: 'cyan' as TrailerUiColor },
      prompt: { order: 100 }
    },
    'Confidence': {
      description: 'Test confidence.', multivalue: false, validation: 'values', isCore: true,
      values: { low: { description: 'Low' }, medium: { description: 'Medium' }, high: { description: 'High' } },
      ui: { kind: 'risk' as TrailerUiKind, color: 'cyan' as TrailerUiColor },
      squash: 'rank-min',
      prompt: { order: 120 }
    },
    'Related': {
      description: 'Related reference.', multivalue: true, validation: 'reference', isCore: true,
      ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
      prompt: { order: 200 }
    },
    'Ref': {
        description: 'Generic reference.', multivalue: true, validation: 'reference', isCore: true,
        ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
    },
    'Supersedes': {
        description: 'Supersedes reference.', multivalue: true, validation: 'reference', isCore: true,
        ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
    },
    'Depends-on': {
        description: 'Dependency reference.', multivalue: true, validation: 'reference', isCore: true,
        ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
    }
  }
};

/** A generic strict namespace protocol definition. */
export const TEST_YAP_DEFINITION: ProtocolDefinition = {
  name: 'YAP',
  version: '2.0',
  namespace: 'yap',
  strict: true,
  permissive: false,
  identityKey: 'YAP-id',
  trailers: {
    'YAP-id': {
      description: 'YAP identity.', multivalue: false, validation: 'pattern',
      pattern: '^[0-9a-f]{8}$', generator: 'hex8', required: true, isCore: true,
      ui: { kind: 'identity' as TrailerUiKind, color: 'dim' as TrailerUiColor },
    },
    'Impact': {
      description: 'Impact level.', multivalue: false, validation: 'values', isCore: true,
      values: { low: { description: 'Low' }, high: { description: 'High' } },
      ui: { kind: 'risk' as TrailerUiKind, color: 'cyan' as TrailerUiColor },
      squash: 'rank-max'
    }
  }
};

/**
 * Helper to ensure a clean engine directory for tests.
 */
export function assertIsolatedEngine(dir: string = TEST_ENGINE_DIR) {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

/** Helper to create a ProtocolConfig with deep partial overrides. */
export function makeProtocolConfig(overrides: Partial<ProtocolConfig> = {}): ProtocolConfig {
  return {
    ...TEST_PROTOCOL_CONFIG,
    ...overrides,
    trailers: { ...TEST_PROTOCOL_CONFIG.trailers, ...(overrides.trailers || {}) },
  };
}

/** High-level factory: returns a REAL Protocol instance. */
export function makeProtocol(
    defOverrides: Partial<ProtocolDefinition> = {},
    configOverrides: Partial<ProtocolConfig> = {}
): Protocol {
    const trailers = { ...TEST_PROTOCOL_DEFINITION.trailers, ...(defOverrides.trailers || {}) };
    
    // If a custom identityKey is provided, and it's not Mock-id, we should
    // remove the default Mock-id to prevent it from being required, unless explicitly kept.
    if (defOverrides.identityKey && defOverrides.identityKey !== TEST_PROTOCOL_DEFINITION.identityKey) {
        if (!defOverrides.trailers || !defOverrides.trailers[TEST_PROTOCOL_DEFINITION.identityKey]) {
            delete trailers[TEST_PROTOCOL_DEFINITION.identityKey];
        }
        // If the new identityKey doesn't have a definition, give it a basic one
        if (!trailers[defOverrides.identityKey]) {
            trailers[defOverrides.identityKey] = {
                type: 'string', required: true, description: 'ID', aliases: [],
                ui: { kind: 'identity', color: 'dim' } as any
            };
        }
    }

    const baseDef: ProtocolDefinition = {
        ...TEST_PROTOCOL_DEFINITION,
        ...defOverrides,
        trailers
    };

    const config = makeProtocolConfig({
        strict: baseDef.strict, permissive: baseDef.permissive, ...configOverrides
    });

    const finalized = ProtocolLoader.applyOverrides([baseDef], { [baseDef.name]: config })[0];
    return new Protocol(finalized);
}

/** High-level factory: returns a REAL ProtocolRegistry instance. */
export function makeProtocolRegistry(protocols: Protocol[] = []): ProtocolRegistry {
    const registry = new ProtocolRegistry();
    for (const p of protocols) registry.register(p);
    return registry;
}

// -----------------------------------------------------------------------------
// REAL COMPONENT FACTORIES (Real Classes, Mocked Dependencies)
// -----------------------------------------------------------------------------

/** Factory: Create a REAL functional AtomRepository with mocked dependencies. */
export function makeAtomRepository(options: {
    gitClient?: any; registry?: ProtocolRegistry; isScoped?: boolean; pathResolver?: PathResolver; searchFilter?: SearchFilter;
} = {}): AtomRepository {
    const registry = options.registry || makeProtocolRegistry([makeProtocol()]);
    const gitClient = options.gitClient || makeMockGitClient();
    return new AtomRepository(
        gitClient, new TrailerParser(), registry,
        options.searchFilter || new SearchFilter(registry),
        options.pathResolver || new PathResolver('/mock', '/mock'),
        new NullAtomCache(), new NullQueryCache(),
        options.isScoped ?? false
    );
}

/** Factory: Create a REAL Validator instance with mocked dependencies. */
export function makeValidator(options: {
    repository?: any; registry?: ProtocolRegistry; config?: EngineConfig;
} = {}): Validator {
    const registry = options.registry || makeProtocolRegistry([makeProtocol()]);
    const repository = options.repository || makeMockAtomRepository();
    const config = options.config || TEST_ENGINE_CONFIG;
    return new Validator(new TrailerParser(), repository, config, registry);
}

/** Factory: Create a REAL StalenessDetector instance with mocked dependencies. */
export function makeStalenessDetector(options: {
    gitClient?: any; config?: EngineConfig; registry?: ProtocolRegistry;
} = {}): StalenessDetector {
    const registry = options.registry || makeProtocolRegistry([makeProtocol()]);
    const gitClient = options.gitClient || makeMockGitClient();
    const config = options.config || TEST_ENGINE_CONFIG;

    return new StalenessDetector(gitClient, config, registry);
}

// -----------------------------------------------------------------------------
// PURE MOCK FACTORIES (Returning vi.fn() objects)
// -----------------------------------------------------------------------------

/** Factory: Create a PURE MOCK GitClient (vi.fn() object). */
export function makeMockGitClient(overrides: any = {}): any {
    return {
        log: vi.fn(async () => []),
        blame: vi.fn(async () => []),
        commit: vi.fn(async () => ({ hash: 'abc123', success: true, message: 'Commit created', rawMessage: '...' })),
        hasStagedChanges: vi.fn(async () => true),
        getRepoRoot: vi.fn(async () => '/mock-repo'),
        isInsideRepo: vi.fn(async () => true),
        getFilesChanged: vi.fn(async () => new Map()),
        countCommitsSince: vi.fn(async () => 0),
        countAllCommits: vi.fn(async () => 0),
        resolveRef: vi.fn(async () => 'head-hash'),
        getHeadMessage: vi.fn(async () => 'message'),
        getCommitsByHashes: vi.fn(async () => []),
        listTrackedFiles: vi.fn(async () => []),
        resolveDate: vi.fn(async (d: string) => {
            const date = new Date(d);
            return isNaN(date.getTime()) ? null : date;
        }),
        ...overrides
    };
}

/** Factory: Create a PURE MOCK TrailerParser (vi.fn() object). */
export function makeMockTrailerParser(overrides: any = {}): any {
  return {
    parse: vi.fn(),
    serialize: vi.fn((trailers: Record<string, string[]>) => {
      const lines: string[] = [];
      const sortedKeys = Object.keys(trailers).sort();
      for (const key of sortedKeys) {
          for (const v of trailers[key]) {
              lines.push(`${key}: ${v}`);
          }
      }
      return lines.join('\n');
    }),
    containsTrailers: vi.fn(),
    extractTrailerBlock: vi.fn(),
    ...overrides
  };
}

/** Factory: Create a PURE MOCK IdGenerator (vi.fn() object). */
export function makeMockIdGenerator(id = 'a1b2c3d4', overrides: any = {}): any {
  return {
    generate: vi.fn(() => id),
    ...overrides
  };
}

/** Factory: Create a PURE MOCK AtomRepository (vi.fn() object). */
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

/** Factory: Create a PURE MOCK SupersessionResolver (vi.fn() object). */
export function makeMockSupersessionResolver(overrides: any = {}): any {
    return {
        resolveAll: vi.fn(() => new Map()),
        filterActive: vi.fn((atoms) => atoms),
        ...overrides
    };
}

/** Factory: Create a PURE MOCK CommitBuilder (vi.fn() object). */
export function makeMockCommitBuilder(overrides: any = {}): any {
    return {
        build: vi.fn(() => ({ message: 'built', protocols: { mock: { id: 'a1b2c3d4', version: '1.0' } } })),
        validate: vi.fn(() => []), 
        ...overrides
    };
}

/** Factory: Create a PURE MOCK CommitInputResolver (vi.fn() object). */
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

/** Factory: Create a PURE MOCK HeadIdReader (vi.fn() object). */
export function makeMockHeadIdReader(overrides: any = {}): any {
    return {
        read: vi.fn(async () => null),
        readIds: vi.fn(async () => ({})),
        ...overrides
    };
}

/** Factory: Create a PURE MOCK ConfigLoader (vi.fn() object). */
export function makeMockConfigLoader(overrides: any = {}): any {
    return {
        resolveRoot: vi.fn(async () => '/mock-repo'),
        findConfigPath: vi.fn(async () => '/mock-repo/.atom/config.toml'),
        load: vi.fn(async () => TEST_ENGINE_CONFIG),
        ...overrides
    };
}

/** Factory: Create a PURE MOCK Prompt (vi.fn() object). */
export function makeMockPrompt(overrides: any = {}): any {
    return {
        askText: vi.fn(async () => ''),
        askMultiline: vi.fn(async () => ''),
        askChoice: vi.fn(async () => ''),
        askConfirm: vi.fn(async () => true),
        close: vi.fn(),
        ...overrides
    };
}

/** Factory: Create a PURE MOCK OutputFormatter (vi.fn() object). */
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

/** A real in-memory logger for checking output in tests. */
export const TestLogger = InMemoryLogger;

// -----------------------------------------------------------------------------
// DOMAIN OBJECT FACTORIES (Real Data Objects)
// -----------------------------------------------------------------------------

/** Factory: Create a REAL RawCommit object. */
export function makeRawCommit(options: { hash?: string; date?: string; author?: string; subject?: string; body?: string; id?: string; trailerExtras?: string; trailers?: string; } = {}): RawCommit {
  const id = options.id ?? 'a1b2c3d4';
  const extras = options.trailerExtras ?? '';
  return {
    hash: options.hash ?? `hash-${id}`,
    date: options.date ?? '2025-01-15T10:00:00Z',
    author: options.author ?? 'dev@example.com',
    subject: options.subject ?? 'feat: test subject',
    body: options.body ?? 'Test body.',
    trailers: options.trailers ?? `${TEST_ID_KEY}: ${id}\n${extras}`.trim(),
  };
}

/** Factory: Create a REAL PathQueryOptions object. */
export function makeQueryOptions(overrides: any = {}): any {
  return {
    scope: null,
    follow: false,
    all: false,
    author: null,
    limit: null,
    maxCommits: null,
    since: null,
    until: null,
    ...overrides,
  };
}

/** Factory: Create a REAL Atom object. */
export function makeAtom(overrides: Partial<Atom & { trailers: Trailers; id: string }> = {}): Atom {
  const id = overrides.id ?? 'a1b2c3d4';
  const trailers = overrides.trailers || { [TEST_ID_KEY]: [id] };
  const protocols = overrides.protocols ?? new Map([['mock', { trailers, unauthorized: {} }]]);
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

/** Factory: Create a REAL Trailers object. */
export function makeTrailers(overrides: Partial<Trailers> = {}): Trailers {
  return {
    [TEST_ID_KEY]: overrides[TEST_ID_KEY] ?? ['a1b2c3d4'],
    Constraint: overrides.Constraint ?? [],
    Confidence: overrides.Confidence ?? [],
    Related: overrides.Related ?? [],
    'Depends-on': overrides['Depends-on'] ?? [],
    ...overrides,
  };
}

/** Factory: Create a REAL HierarchicalTrailers object. */
export function makeHierarchicalTrailers(overrides: Partial<HierarchicalTrailers> = {}): HierarchicalTrailers {
    return { '': makeTrailers(overrides[''] ?? {}), ...overrides };
}
