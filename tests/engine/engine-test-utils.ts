import { vi } from 'vitest';
import { 
    ProtocolMap, 
    type Atom, 
    type Trailers, 
    type HierarchicalTrailers,
    ProtocolRegistry,
    InMemoryLogger,
    TrailerParser,
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
    makeStubProtocolRegistry,
    makeStubAtomHydrator,
    makeStubAtomRepository,
    makeStubTargetFactory,
    makeStubSupersessionResolver,
    makeStubHeadIdReader,
    makeStubCommitBuilder,
    makeStubValidator,
    makeStubStalenessDetector,
    makeRawCommit,
    makeProtocolConfig,
    makeQueryTarget
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

/** Factory: Create a PURE MOCK ProtocolRegistry (vi.fn() object). */
export function makeMockProtocolRegistry(overrides: any = {}): any {
    const stub = makeStubProtocolRegistry();
    return {
        ...stub,
        get: vi.fn(stub.get),
        getAll: vi.fn(stub.getAll),
        detect: vi.fn(stub.detect),
        getClaimedKeys: vi.fn(stub.getClaimedKeys),
        getDiscoveryPatterns: vi.fn(stub.getDiscoveryPatterns),
        getSearchPatterns: vi.fn(stub.getSearchPatterns),
        getIdentity: vi.fn(stub.getIdentity),
        resolveIdentity: vi.fn(stub.resolveIdentity),
        getFingerprint: vi.fn(stub.getFingerprint),
        register: vi.fn(stub.register),
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
        loadForPath: vi.fn(stub.loadForPath),
        loadFromFile: vi.fn(stub.loadFromFile),
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
    const stub = makeStubAtomRepository(overrides);
    return {
        ...stub,
        find: vi.fn(stub.find),
        findAll: vi.fn(stub.findAll),
        findById: vi.fn(stub.findById),
        findByIds: vi.fn(stub.findByIds),
        findByRange: vi.fn(stub.findByRange),
        findByCommitHash: vi.fn(stub.findByCommitHash),
        findByScope: vi.fn(stub.findByScope),
        resolveFollowLinks: vi.fn(stub.resolveFollowLinks),
        extractReferenceIds: vi.fn(stub.extractReferenceIds)
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
    const stub = makeStubSupersessionResolver(overrides);
    return {
        ...stub,
        resolve: vi.fn(stub.resolve),
        resolveAll: vi.fn(stub.resolveAll)
    };
}

/** Factory: Create a PURE MOCK HeadIdReader (vi.fn() object). */
export function makeMockHeadIdReader(overrides: any = {}): any {
    const stub = makeStubHeadIdReader(overrides);
    return {
        ...stub,
        read: vi.fn(stub.read),
        readIds: vi.fn(stub.readIds)
    };
}

/** Factory: Create a PURE MOCK CommitBuilder (vi.fn() object). */
export function makeMockCommitBuilder(overrides: any = {}): any {
    const stub = makeStubCommitBuilder(overrides);
    return {
        ...stub,
        build: vi.fn(stub.build),
        validate: vi.fn(stub.validate)
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
    const stub = makeStubAtomHydrator(overrides);
    return {
        ...stub,
        hydrate: vi.fn(stub.hydrate),
        extractReferenceIds: vi.fn(stub.extractReferenceIds)
    };
}

/** Factory: Create a PURE MOCK StalenessDetector (vi.fn() object). */
export function makeMockStalenessDetector(overrides: any = {}): any {
    const stub = makeStubStalenessDetector(overrides);
    return {
        ...stub,
        detect: vi.fn(stub.detect)
    };
}

/** Factory: Create a PURE MOCK Validator (vi.fn() object). */
export function makeMockValidator(overrides: any = {}): any {
    const stub = makeStubValidator(overrides);
    return {
        ...stub,
        validate: vi.fn(stub.validate)
    };
}

/** Factory: Create a PURE MOCK QueryTargetFactory (vi.fn() object). */
export function makeMockTargetFactory(overrides: any = {}): any {
    const stub = makeStubTargetFactory(overrides);
    return {
        create: vi.fn(stub.create),
        fromIdentities: vi.fn(stub.fromIdentities)
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
