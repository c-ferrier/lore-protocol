import { vi } from 'vitest';
import { 
    makeProtocolRegistry, 
    makeProtocol, 
    makeStubGitClient, 
    makeStubPrompt, 
    makeStubFormatter, 
    makeStubConfigLoader, 
    makeStubInputResolver, 
    makeStubHeadIdReader, 
    makeStubAtomRepository, 
    makeStubValidator, 
    makeStubStalenessDetector, 
    makeStubProtocolRegistry,
    makeStubProtocol,
    TEST_ENGINE_CONFIG,
    createProtocolContext
} from '../../src/engine/testing.js';
import { AtomRepository } from '../../src/engine/services/atom-repository.js';
import { InMemoryLogger } from '../../src/engine/services/in-memory-logger.js';

// 1. Vitest Spies (Middlemen)
// These wrap framework-agnostic stubs in Vitest mock functions.

export function makeMockGitClient(overrides: any = {}): any {
    const stub = makeStubGitClient(overrides);
    return { 
        ...stub, 
        query: vi.fn(stub.query),
        resolveDate: vi.fn(stub.resolveDate),
        getCommitsByHashes: vi.fn(stub.getCommitsByHashes),
        blame: vi.fn(stub.blame),
        getFilesChanged: vi.fn(async () => new Map()),
        resolveRef: vi.fn(stub.resolveRef),
        getRepoRoot: vi.fn(stub.getRepoRoot),
        hasStagedChanges: vi.fn(async () => true),
        isInsideRepo: vi.fn(async () => true),
        getHeadMessage: vi.fn(async () => 'feat: head'),
        countCommitsSince: vi.fn(async () => 0),
        log: vi.fn(async () => []),
        commit: vi.fn(async () => ({ hash: 'new-hash', message: 'new message' }))
    };
}

export function makeMockProtocolRegistry(protocols: any[] = []): any {
    const registry = makeProtocolRegistry(protocols);
    return registry;
}

export function makeMockQueryCache(overrides: any = {}): any {
    return {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
        ...overrides
    };
}

export function makeMockConfigLoader(overrides: any = {}): any {
    const stub = makeStubConfigLoader(overrides);
    return { 
        ...stub, 
        load: vi.fn(stub.load),
        findConfigPath: vi.fn(async () => null),
    };
}

export function makeMockFormatter(overrides: any = {}): any {
    return {
        formatQueryResult: vi.fn().mockReturnValue(''),
        formatValidationResult: vi.fn().mockReturnValue(''),
        formatStalenessResult: vi.fn().mockReturnValue(''),
        formatTraceResult: vi.fn().mockReturnValue(''),
        formatConfigResult: vi.fn().mockReturnValue(''),
        formatDoctorResult: vi.fn().mockReturnValue(''),
        formatSuccess: vi.fn().mockReturnValue(''),
        formatError: vi.fn().mockReturnValue(''),
        ...overrides
    };
}

export function makeMockAtomRepository(overrides: any = {}): any {
    const stub = makeStubAtomRepository(overrides);
    const mock: any = { 
        ...stub, 
        find: vi.fn(stub.find), 
        findByIds: vi.fn(stub.findByIds),
        findById: vi.fn(async (id: any, opts: any) => {
            const results = await mock.findByIds([id], opts);
            return results[0] || null;
        }),
        findByCommitHash: vi.fn(async (hash: string) => null)
    };
    return mock;
}

export function makeMockPrompt(overrides: any = {}): any {
    const stub = makeStubPrompt(overrides);
    return { 
        ...stub, 
        askConfirm: vi.fn(stub.askConfirm), 
        askChoice: vi.fn(stub.askChoice), 
        askInput: vi.fn(stub.askInput) 
    };
}

export function makeMockHeadIdReader(overrides: any = {}): any {
    return {
        readIds: vi.fn().mockResolvedValue({}),
        ...overrides
    };
}

export function makeMockInputResolver(overrides: any = {}): any {
    return {
        resolve: vi.fn().mockResolvedValue({}),
        read: vi.fn().mockResolvedValue({ subject: 'test', trailers: new Map() }),
        ...overrides
    };
}

export function makeMockStalenessDetector(overrides: any = {}): any {
    const stub = makeStubStalenessDetector(overrides);
    return { ...stub, detect: vi.fn(stub.detect) };
}

export function makeMockValidator(overrides: any = {}): any {
    const stub = makeStubValidator(overrides);
    return { ...stub, validate: vi.fn(stub.validate) };
}

export function makeMockProtocol(overrides: any = {}): any {
    const stub = makeStubProtocol(overrides);
    const ctx = createProtocolContext(stub.def);
    
    // Helper to either use provided mock or wrap stub method
    const wrap = (key: string) => {
        if (overrides[key] && (overrides[key]._isMockFunction || typeof overrides[key] === 'function')) {
            return overrides[key];
        }
        const member = (stub as any)[key];
        if (typeof member === 'function') {
            return vi.fn(member.bind(stub));
        }
        return member;
    };

    const mock = {
        name: stub.name,
        version: stub.version,
        strict: stub.strict,
        permissive: stub.permissive,
        identityKey: stub.identityKey,
        storageNamespace: stub.storageNamespace,
        context: stub, // Self-referential context
        def: stub.def,
        caseMap: ctx.caseMap,
        isRoot: ctx.isRoot,
        storagePrefix: ctx.storagePrefix,
        authorize: wrap('authorize'),
        getAuthorizedKeys: wrap('getAuthorizedKeys'),
        getScalarKeys: wrap('getScalarKeys'),
        getListKeys: wrap('getListKeys'),
        getReferenceKeys: wrap('getReferenceKeys'),
        getDefinition: wrap('getDefinition'),
        owns: wrap('owns'),
        isRootProtocol: wrap('isRootProtocol'),
        isValidIdentity: wrap('isValidIdentity'),
        parse: wrap('parse'),
        normalize: wrap('normalize'),
        getIdentity: wrap('getIdentity'),
        validateState: wrap('validateState'),
        validateTrailer: wrap('validateTrailer'),
        isCore: wrap('isCore'),
        matches: wrap('matches'),
        getFormattableDefinitions: wrap('getFormattableDefinitions'),
        getStaleSignals: wrap('getStaleSignals'),
        getDiscoveryPatterns: wrap('getDiscoveryPatterns'),
        getSearchPatterns: wrap('getSearchPatterns'),
        claims: wrap('claims'),
    };
    return mock;
}

export const createMockProtocol = makeMockProtocol;
export const TestLogger = InMemoryLogger;

// 2. Specialized Helper wrappers

export function makeAtomRepository(options: any = {}): AtomRepository {
    const registry = options.registry || makeProtocolRegistry([makeProtocol({ name: 'RepoMock' })]);
    const gitClient = options.gitClient || makeMockGitClient();
    const cache = options.cache || makeMockQueryCache();
    
    const baseTarget = options.baseTarget || {
        raw: '',
        type: 'global' as const,
        resolvedPaths: []
    };

    return new AtomRepository(
        gitClient,
        registry,
        cache,
        baseTarget
    );
}

export function makeQueryOptions(overrides: any = {}): any {
  return {
    ...overrides
  };
}
