import { vi } from 'vitest';
import { 
    ProtocolMap, 
    type Atom, 
    type Trailers, 
    type HierarchicalTrailers,
    ProtocolRegistry,
    InMemoryLogger,
    TrailerParser,
    NullAtomCache,
    NullQueryCache,
    Validator,
    StalenessDetector,
    AtomHydrator,
    AtomRepository,
    PathResolver,
    SearchFilter,
    Protocol,
    ProtocolLoader,
    CommitBuilder,
    IdGenerator,
    TEST_ID_KEY,
    TEST_ENGINE_CONFIG,
    TEST_PROTOCOL_DEFINITION,
    TEST_PROTOCOL_CONFIG,
    makeCommitInput,
    makeAtom,
    makeTrailers,
    makeStubProtocol,
    makeStubGitClient,
    makeStubConfigLoader,
    makeStubFormatter,
    makeStubInputResolver,
    makeStubPrompt,
    makeRawCommit
} from '../../src/engine/testing.js';

// SOURCE EVERYTHING FROM THE TESTING GATEWAY
export * from '../../src/engine/testing.js';

/**
 * =============================================================================
 * VITEST-SPECIFIC MOCK FACTORIES (THE BRIDGE)
 * =============================================================================
 * These factories rely on the Vitest `vi.fn()` global.
 * 
 * DESIGN PRINCIPLE: "LOCAL EYES"
 * These factories contain ZERO business logic or default values.
 * They simply wrap the "Brain" (the framework-agnostic stubs from the testing 
 * gateway) in Vitest spy dashboards (vi.fn()).
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// SPY WRAPPERS (Adding observability to engine stubs)
// -----------------------------------------------------------------------------

/** Factory: Create a PURE MOCK GitClient (vi.fn() object). */
export function makeMockGitClient(overrides: any = {}): any {
    const stub = makeStubGitClient(overrides);
    return {
        ...stub,
        log: vi.fn(stub.log),
        query: vi.fn(stub.query),
        blame: vi.fn(stub.blame),
        commit: vi.fn(stub.commit),
        hasStagedChanges: vi.fn(stub.hasStagedChanges),
        getRepoRoot: vi.fn(stub.getRepoRoot),
        isInsideRepo: vi.fn(stub.isInsideRepo),
        getFilesChanged: vi.fn(stub.getFilesChanged),
        getCommitsByHashes: vi.fn(stub.getCommitsByHashes),
        countCommitsSince: vi.fn(stub.countCommitsSince),
        resolveRef: vi.fn(stub.resolveRef),
        resolveDate: vi.fn(stub.resolveDate),
        getHeadMessage: vi.fn(stub.getHeadMessage)
    };
}

/** Factory: Create a PURE MOCK AtomCache (vi.fn() object). */
export function makeMockAtomCache(overrides: any = {}): any {
    return {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
        ...overrides
    };
}

/** Factory: Create a PURE MOCK QueryCache (vi.fn() object). */
export function makeMockQueryCache(overrides: any = {}): any {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    ...overrides
  };
}

/** Factory: Create a PURE MOCK ConfigLoader (vi.fn() object). */
export function makeMockConfigLoader(overrides: any = {}): any {
    const stub = makeStubConfigLoader(overrides);
    return {
        ...stub,
        load: vi.fn(stub.load),
        save: vi.fn(stub.save),
        findConfigPath: vi.fn(stub.findConfigPath)
    };
}

/** Factory: Create a PURE MOCK OutputFormatter (vi.fn() object). */
export function makeMockFormatter(overrides: any = {}): any {
    const stub = makeStubFormatter(overrides);
    return {
        ...stub,
        formatQueryResult: vi.fn(stub.formatQueryResult),
        formatValidationResult: vi.fn(stub.formatValidationResult),
        formatStalenessResult: vi.fn(stub.formatStalenessResult),
        formatTraceResult: vi.fn(stub.formatTraceResult),
        formatDoctorResult: vi.fn(stub.formatDoctorResult),
        formatSuccess: vi.fn(stub.formatSuccess),
        formatError: vi.fn(stub.formatError),
        formatConfig: vi.fn(stub.formatConfig)
    };
}

/** Factory: Create a PURE MOCK AtomRepository (vi.fn() object). */
export function makeMockAtomRepository(overrides: any = {}): any {
    return {
        findAll: vi.fn(async () => []),
        findById: vi.fn(async () => null),
        findByIds: vi.fn(async () => []),
        findByRange: vi.fn(async () => []),
        findHistory: vi.fn(async () => []),
        extractReferenceIds: vi.fn(() => []),
        resolveFollowLinks: vi.fn(async (atoms) => atoms),
        find: vi.fn(async () => []),
        ...overrides
    };
}

/** Factory: Create a HIGH-FIDELITY MOCK TrailerParser (vi.fn() object). */
export function makeMockTrailerParser(overrides: any = {}): any {
    const realParser = new TrailerParser();
    return {
        parse: vi.fn((t) => realParser.parse(t)),
        serialize: vi.fn((t, o) => realParser.serialize(t, o)),
        extractTrailerBlock: vi.fn((m) => realParser.extractTrailerBlock(m)),
        ...overrides
    };
}

/** Factory: Create a PURE MOCK IdGenerator (vi.fn() object). */
export function makeMockIdGenerator(overrides: any = {}): any {
    return {
        generate: vi.fn(() => 'a1b2c3d4'),
        isValid: vi.fn(() => true),
        ...overrides
    };
}

/** Factory: Create a PURE MOCK Prompt (vi.fn() object). */
export function makeMockPrompt(overrides: any = {}): any {
    const stub = makeStubPrompt(overrides);
    return {
        ...stub,
        askText: vi.fn(stub.askText),
        askConfirm: vi.fn(stub.askConfirm),
        askChoice: vi.fn(stub.askChoice),
        askMultiline: vi.fn(stub.askMultiline),
        close: vi.fn(stub.close)
    };
}

/** Factory: Create a PURE MOCK SupersessionResolver (vi.fn() object). */
export function makeMockSupersessionResolver(overrides: any = {}): any {
    return {
        resolve: vi.fn(async () => ({ superseded: false, supersededBy: null })),
        resolveAll: vi.fn(async () => new Map()),
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

/** Factory: Create a PURE MOCK CommitBuilder (vi.fn() object). */
export function makeMockCommitBuilder(overrides: any = {}): any {
    return {
        build: vi.fn(() => ({ message: 'built', protocols: {} })),
        validate: vi.fn(() => []),
        ...overrides
    };
}

/** Factory: Create a PURE MOCK CommitInputResolver (vi.fn() object). */
export function makeMockInputResolver(overrides: any = {}): any {
    const stub = makeStubInputResolver(overrides);
    return {
        ...stub,
        read: vi.fn(stub.read)
    };
}

/** Factory: Create a PURE MOCK AtomHydrator (vi.fn() object). */
export function makeMockAtomHydrator(overrides: any = {}): any {
    return {
        hydrate: vi.fn(async (c) => makeAtom({ commitHash: c.hash })),
        hydrateAll: vi.fn(async (cs) => cs.map(c => makeAtom({ commitHash: c.hash }))),
        ...overrides
    };
}

/** Factory: Create a PURE MOCK StalenessDetector (vi.fn() object). */
export function makeMockStalenessDetector(overrides: any = {}): any {
    return {
        detect: vi.fn(async () => []),
        ...overrides
    };
}

/** Factory: Create a PURE MOCK Validator (vi.fn() object). */
export function makeMockValidator(overrides: any = {}): any {
    return {
        validate: vi.fn(() => []),
        ...overrides
    };
}

/** Factory: Create a PURE MOCK Protocol (vi.fn() object). */
export function makeMockProtocol(overrides: any = {}): any {
    const stub = makeStubProtocol(overrides);
    
    // Wrap all stub functions in Vitest mocks
    const mock = {
        ...stub,
        getStorageNamespace: vi.fn(stub.getStorageNamespace),
        setRegistry: vi.fn(stub.setRegistry),
        getDiscoveryPatterns: vi.fn(stub.getDiscoveryPatterns),
        getSearchPatterns: vi.fn(stub.getSearchPatterns),
        getIdentityPattern: vi.fn(stub.getIdentityPattern),
        authorize: vi.fn(stub.authorize),
        getAuthorizedKeys: vi.fn(stub.getAuthorizedKeys),
        getAllKeys: vi.fn(stub.getAllKeys),
        getScalarKeys: vi.fn(stub.getScalarKeys),
        getListKeys: vi.fn(stub.getListKeys),
        getReferenceKeys: vi.fn(stub.getReferenceKeys),
        getUiKind: vi.fn(stub.getUiKind),
        getUiColor: vi.fn(stub.getUiColor),
        getDefinition: vi.fn(stub.getDefinition),
        isCore: vi.fn(stub.isCore),
        isValidIdentity: vi.fn(stub.isValidIdentity),
        normalize: vi.fn(stub.normalize),
        validateState: vi.fn(stub.validateState),
        validateTrailer: vi.fn(stub.validateTrailer),
        matches: vi.fn(stub.matches),
        claims: vi.fn(stub.claims),
        getIdentity: vi.fn(stub.getIdentity),
        getFormattableDefinitions: vi.fn(stub.getFormattableDefinitions),
        owns: vi.fn(stub.owns),
        getStaleSignals: vi.fn(stub.getStaleSignals),
        parse: vi.fn(stub.parse)
    };

    return mock;
}

/** A real in-memory logger for checking output in tests. */
export const TestLogger = InMemoryLogger;

/** Helper for generating query options. */
export function makeQueryOptions(overrides: any = {}): any {
    return {
        filters: [],
        ...overrides
    };
}
