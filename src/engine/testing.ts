import { existsSync, mkdirSync } from 'node:fs';
import { ProtocolMap, type ProtocolName } from './util/protocol-map.js';
import { Protocol } from './services/protocol.js';
import { ProtocolRegistry } from './services/protocol-registry.js';
import { ProtocolLoader } from './services/protocol/protocol-loader.js';
import { AtomHydrator } from './services/atom-hydrator.js';
import { AtomRepository } from './services/atom-repository.js';
import { Validator } from './services/validator.js';
import { StalenessDetector } from './services/staleness-detector.js';
import { SearchFilter } from './services/search-filter.js';
import { PathResolver } from './services/path-resolver.js';
import { TrailerParser } from './services/trailer-parser.js';
import { NullAtomCache } from './services/atom-cache.js';
import { NullQueryCache } from './services/query-cache.js';
import { InMemoryLogger } from './services/in-memory-logger.js';
import { TerminalLogger } from './services/terminal-logger.js';
import { CommitBuilder } from './services/commit-builder.js';
import { IdGenerator } from './services/id-generator.js';

import type { 
    Atom, 
    Trailers, 
    HierarchicalTrailers,
    ProtocolState,
    SupersessionStatus,
    StaleReason,
    StaleSignal
} from './types/domain.js';
import type { IProtocol, ActiveTrailer } from './interfaces/protocol.js';
import type { IGitClient, RawCommit, CommitResult, BlameLine } from './interfaces/git-client.js';
import type { IAtomCache } from './interfaces/atom-cache.js';
import type { IQueryCache } from './interfaces/query-cache.js';
import type { IOutputFormatter, ErrorMessage } from './interfaces/output-formatter.js';
import type { ProtocolDefinition } from './interfaces/protocol-definition.js';
import type { EngineConfig, ProtocolConfig, TrailerUiKind, TrailerUiColor, TrailerDefinition } from './types/config.js';
import type { CommitInput } from './types/commit.js';
import type { ValidationIssue, FormattableTrailerDefinition } from './types/output.js';
import type { QualifiedFilter } from './types/query.js';
import type { QueryIdentity } from './types/query.js';
import type { IConfigLoader } from './interfaces/config-loader.js';
import type { IPrompt } from './interfaces/prompt.js';
import type { ICommitInputReader } from './interfaces/commit-input-reader.js';

/**
 * =============================================================================
 * ATOM ENGINE TESTING GATEWAY
 * =============================================================================
 * This file provides standardized factories, stubs, and constants for testing 
 * Atom Engine components and protocol implementations.
 * =============================================================================
 * DESIGN PRINCIPLE: "CENTRALIZED BRAIN"
 * All default logic, working values (like 'head-hash'), and interface-compliant 
 * behaviors live HERE in framework-agnostic Stubs. 
 * Framework-specific spies (like Vitest vi.fn()) should only wrap these stubs.
 * =============================================================================
 */

// Re-export production services for integration testing
export { 
    Protocol, 
    ProtocolRegistry, 
    ProtocolLoader, 
    AtomHydrator, 
    AtomRepository, 
    Validator, 
    StalenessDetector, 
    SearchFilter, 
    PathResolver, 
    TrailerParser,
    NullAtomCache,
    NullQueryCache,
    InMemoryLogger,
    TerminalLogger,
    CommitBuilder,
    IdGenerator,
    ProtocolMap,
    type ProtocolName,
    type Atom,
    type Trailers,
    type HierarchicalTrailers,
    type ProtocolState
};

/** Key for the standard baseline protocol ID. */
export const TEST_ID_KEY = 'Mock-id';

/** A clean directory name for engine-level unit testing. */
export const TEST_ENGINE_DIR = '.test-engine';

/** Helper to ensure a clean engine directory for tests. */
export function assertIsolatedEngine(dir: string = TEST_ENGINE_DIR) {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

/** A standard, valid engine configuration. */
export const TEST_ENGINE_CONFIG: EngineConfig = {
  validation: { maxMessageLines: 50, subjectMaxLength: 50 }, // Restore authoritative defaults for Validator tests
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

// --- Infrastructure Factories ---

/** Helper to create a ProtocolConfig with deep partial overrides. */
export function makeProtocolConfig(overrides: Partial<ProtocolConfig> = {}): ProtocolConfig {
  return {
    ...TEST_PROTOCOL_CONFIG,
    ...overrides,
    trailers: { ...TEST_PROTOCOL_CONFIG.trailers, ...(overrides.trailers || {}) },
  };
}

/** Helper: returns a REAL Protocol instance. */
export function makeProtocol(
    defOverrides: Partial<ProtocolDefinition> = {},
    configOverrides: Partial<ProtocolConfig> = {}
): Protocol {
    const trailers = { ...TEST_PROTOCOL_DEFINITION.trailers, ...(defOverrides.trailers || {}) };
    
    if (defOverrides.identityKey && defOverrides.identityKey !== TEST_PROTOCOL_DEFINITION.identityKey) {
        if (!defOverrides.trailers || !defOverrides.trailers[TEST_PROTOCOL_DEFINITION.identityKey]) {
            delete trailers[TEST_PROTOCOL_DEFINITION.identityKey];
        }
        if (!trailers[defOverrides.identityKey]) {
            trailers[defOverrides.identityKey] = {
                required: true, description: 'ID', multivalue: false, validation: 'none',
                ui: { kind: 'identity', color: 'dim' } as any
            };
        }
    }

    const finalized = ProtocolLoader.applyOverrides([{ ...TEST_PROTOCOL_DEFINITION, ...defOverrides, trailers }], { [defOverrides.name || 'Mock']: { ...TEST_PROTOCOL_CONFIG, ...configOverrides } })[0];
    return new Protocol(finalized);
}

/** Helper: returns a REAL ProtocolRegistry instance. */
export function makeProtocolRegistry(protocols: Protocol[] = []): ProtocolRegistry {
    const registry = new ProtocolRegistry();
    for (const p of protocols) registry.register(p);
    return registry;
}

// --- Component Factories ---

/** Factory: Create a REAL functional AtomHydrator with mocked dependencies. */
export function makeAtomHydrator(options: {
    gitClient?: any; registry?: ProtocolRegistry; atomCache?: any;
} = {}): AtomHydrator {
    const registry = options.registry || makeProtocolRegistry([makeProtocol()]);
    const gitClient = options.gitClient || makeStubGitClient();
    return new AtomHydrator(
        gitClient, new TrailerParser(), registry,
        options.atomCache || new NullAtomCache()
    );
}

/** Factory: Create a REAL functional AtomRepository with mocked dependencies. */
export function makeAtomRepository(options: {
    gitClient?: any; registry?: ProtocolRegistry; isScoped?: boolean; pathResolver?: PathResolver; searchFilter?: SearchFilter; hydrator?: AtomHydrator;
} = {}): AtomRepository {
    const registry = options.registry || makeProtocolRegistry([makeProtocol()]);
    const gitClient = options.gitClient || makeStubGitClient();
    const hydrator = options.hydrator || makeAtomHydrator({ gitClient, registry });
    
    return new AtomRepository(
        gitClient, hydrator, registry,
        options.searchFilter || new SearchFilter(registry),
        options.pathResolver || new PathResolver('/mock', '/mock'),
        new NullQueryCache(),
        options.isScoped ?? false
    );
}

// --- Pure Mock Stubs (THE BRAIN) ---
// These implement the "Logic and Defaults" for testing, without any framework dependencies.

/** Stub: Create a strictly-typed stubbed GitClient object. */
export function makeStubGitClient(overrides: Partial<IGitClient> = {}): IGitClient {
    return {
        log: async () => [],
        query: async () => [],
        blame: async () => [],
        commit: async () => ({ hash: 'abc123', success: true, message: 'Success' }),
        hasStagedChanges: async () => true,
        getRepoRoot: async () => '/mock-repo',
        isInsideRepo: async () => true,
        getFilesChanged: async () => new Map(),
        getCommitsByHashes: async () => [],
        countCommitsSince: async () => 0,
        resolveRef: async () => 'head-hash',
        resolveDate: async (d) => {
            const date = new Date(d);
            return isNaN(date.getTime()) ? null : date;
        },
        getHeadMessage: async () => 'message',
        ...overrides
    };
}

/** Stub: Create a strictly-typed stubbed Protocol object. */
export function makeStubProtocol(overrides: Partial<IProtocol> = {}): IProtocol {
    const name = (overrides.name || 'Mock').toLowerCase();
    const namespace = overrides.getStorageNamespace?.() || '';
    const identityKey = overrides.identityKey || `${name}-id`;
    
    return {
        version: '1.0',
        strict: true,
        permissive: false,
        identityKey,
        getStorageNamespace: () => namespace,
        setRegistry: () => {},
        getDiscoveryPatterns: () => [],
        getSearchPatterns: () => [],
        getIdentityPattern: () => '',
        authorize: (key: string) => key,
        getAuthorizedKeys: () => [],
        getAllKeys: () => [],
        getScalarKeys: () => [],
        getListKeys: () => [],
        getReferenceKeys: () => [],
        getUiKind: () => 'text' as any,
        getUiColor: () => 'dim' as any,
        getDefinition: () => null,
        isCore: () => false,
        isValidIdentity: () => true,
        normalize: () => ({ trailers: {}, unauthorized: {} }),
        validateState: () => [],
        validateTrailer: () => ({ valid: true }),
        matches: () => true,
        claims: () => false,
        getIdentity: () => null,
        getFormattableDefinitions: () => ({}),
        owns: (key: string) => {
            const lowerKey = key.toLowerCase();
            return lowerKey === name || 
                   (namespace !== '' && lowerKey === namespace.toLowerCase()) ||
                   lowerKey === identityKey.toLowerCase();
        },
        getStaleSignals: () => [],
        parse: () => ({ trailers: {}, unauthorized: {} }),
        ...overrides,
        name // Enforce canonical name AFTER overrides
    };
}

/** Stub: Create a strictly-typed stubbed ConfigLoader object. */
export function makeStubConfigLoader<T = any>(overrides: Partial<IConfigLoader<T>> = {}): IConfigLoader<T> {
    return {
        loadForPath: async () => TEST_ENGINE_CONFIG as any as T,
        loadFromFile: async () => TEST_ENGINE_CONFIG as any as T,
        findConfigPath: async () => null,
        ...overrides
    };
}

/** Stub: Create a strictly-typed stubbed IPrompt object. */
export function makeStubPrompt(overrides: Partial<IPrompt> = {}): IPrompt {
    return {
        askText: async () => '',
        askConfirm: async () => false,
        askChoice: async <T extends string>(m: string, choices: readonly T[]) => choices[0],
        askMultiline: async () => '',
        close: async () => {},
        ...overrides
    };
}

/** Stub: Create a strictly-typed stubbed IOutputFormatter object. */
export function makeStubFormatter(overrides: Partial<IOutputFormatter> = {}): IOutputFormatter {
    return {
        formatQueryResult: () => 'formatted query result',
        formatValidationResult: () => 'formatted validation result',
        formatStalenessResult: () => 'formatted staleness result',
        formatTraceResult: () => 'formatted trace result',
        formatDoctorResult: () => 'formatted doctor result',
        formatSuccess: (m) => m,
        formatError: (code, messages) => messages[0]?.message || 'error',
        formatConfig: () => 'formatted config',
        ...overrides
    };
}

/** Stub: Create a strictly-typed stubbed ICommitInputReader object. */
export function makeStubInputResolver(overrides: Partial<ICommitInputReader> = {}): ICommitInputReader {
    return {
        read: async () => ({ subject: 'test', trailers: new ProtocolMap() }),
        ...overrides
    };
}

// --- Data Object Factories ---

/** Factory: Create a strictly compliant CommitInput. */
export function makeCommitInput(overrides: Partial<CommitInput> = {}): CommitInput {
    const trailersMap = new ProtocolMap<Trailers>();
    if (overrides.trailers) {
        if (overrides.trailers instanceof Map) {
            for (const [k, v] of overrides.trailers.entries()) trailersMap.set(k, v);
        } else {
            for (const [k, v] of Object.entries(overrides.trailers as any)) trailersMap.set(k, v as Trailers);
        }
    }
    return {
        subject: overrides.subject ?? 'feat: test commit',
        body: overrides.body,
        trailers: trailersMap,
    };
}

/** Factory: Create a REAL Atom object. */
export function makeAtom(overrides: Partial<Atom & { trailers: Trailers; id: string }> = {}): Atom {
  const id = overrides.id ?? 'a1b2c3d4';
  const trailers = overrides.trailers || { [TEST_ID_KEY]: [id] };
  const protocols = overrides.protocols ?? new ProtocolMap<ProtocolState>();
  if (!overrides.protocols) protocols.set('mock', { trailers, unauthorized: {} });
  
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
    ...overrides,
  };
}

/** Factory: Create a REAL RawCommit object. */
export function makeRawCommit(options: { hash?: string; id?: string; trailers?: string; author?: string; date?: string; body?: string; subject?: string; } = {}): RawCommit {
  const id = options.id ?? 'a1b2c3d4';
  return {
    hash: options.hash ?? `hash-${id}`,
    date: options.date ?? '2025-01-15T10:00:00Z',
    author: options.author ?? 'dev@example.com',
    subject: options.subject ?? 'feat: test subject',
    body: options.body ?? 'Test body.',
    trailers: options.trailers ?? `${TEST_ID_KEY}: ${id}`.trim(),
  };
}
