import { type Mock, vi } from 'vitest';

import type { ProtocolContext,ProtocolDefinition } from '../../src/engine/core/types/protocol-definition.js';
import { QueryTargetAST } from '../../src/engine/core/types/query.js';
import type { IConfigLoader } from '../../src/engine/interfaces/config-loader.js';
import type { IGitClient } from '../../src/engine/interfaces/git-client.js';
import { type ILogger,LogLevel } from '../../src/engine/interfaces/logger.js';
import type { IOutputFormatter } from '../../src/engine/interfaces/output-formatter.js';
import type { IPrompt } from '../../src/engine/interfaces/prompt.js';
import type { IQueryCache } from '../../src/engine/interfaces/query-cache.js';
import { AtomRepository } from '../../src/engine/services/atom-repository.js';
import { ProtocolRegistry } from '../../src/engine/services/protocol-registry.js';
import { 
    createProtocolContext,
    makeAtom,
    makeAtomRepository,
    makeQueryTarget,
    makeRawCommit,
    makeStubAtomRepository, 
    makeStubConfigLoader, 
    makeStubFormatter,
    makeStubGitClient, 
    makeStubPrompt, 
    makeStubProtocolContext,
    makeStubProtocolRegistry, 
    makeStubQueryCache,
    makeStubQueryOptions,
    ProtocolMap,
    type ProtocolState,
    TEST_ENGINE_CONFIG} from '../../src/engine/testing.js';

/**
 * =============================================================================
 * VITEST MOCK HARNESS (PRIVATE)
 * =============================================================================
 * Standard naming: makeMock[Type] always returns a Vitest spy-wrapped object.
 * They delegate to the framework-agnostic stubs in src/engine/testing.ts.
 */

export type MockedGitClient = IGitClient & { [K in keyof IGitClient]: Mock };

export function makeMockGitClient(overrides: Partial<IGitClient> = {}): MockedGitClient {
    const stub = makeStubGitClient(overrides);
    return { 
        ...stub, 
        query: vi.fn(stub.query),
        resolveDate: vi.fn(stub.resolveDate),
        getCommitsByHashes: vi.fn(stub.getCommitsByHashes),
        blame: vi.fn(stub.blame),
        getFilesChanged: vi.fn(stub.getFilesChanged),
        resolveRef: vi.fn(stub.resolveRef),
        getRepoRoot: vi.fn(stub.getRepoRoot),
        hasStagedChanges: vi.fn(stub.hasStagedChanges),
        isInsideRepo: vi.fn(stub.isInsideRepo),
        getHeadMessage: vi.fn(stub.getHeadMessage),
        getFilesChangedSince: vi.fn(stub.getFilesChangedSince),
        log: vi.fn(stub.log),
        commit: vi.fn(stub.commit)
    } as unknown as MockedGitClient;
}

export function makeMockProtocolRegistry(protocols: ProtocolContext[] = []): ProtocolRegistry {
    const registry = makeStubProtocolRegistry(protocols);
    return registry;
}

export type MockedQueryCache = IQueryCache & { [K in keyof IQueryCache]: Mock };

export function makeMockQueryCache(overrides: Partial<IQueryCache> = {}): MockedQueryCache {
    const stub = makeStubQueryCache(overrides);
    return {
        ...stub,
        get: vi.fn(stub.get),
        set: vi.fn(stub.set),
        prune: vi.fn(stub.prune)
    } as unknown as MockedQueryCache;
}

export type MockedConfigLoader = IConfigLoader<unknown> & { [K in keyof IConfigLoader<unknown>]: Mock };

export function makeMockConfigLoader(overrides: Partial<IConfigLoader<unknown>> = {}): MockedConfigLoader {
    const stub = makeStubConfigLoader(overrides);
    return { 
        ...stub, 
        loadForPath: vi.fn(stub.loadForPath),
        loadFromFile: vi.fn(stub.loadFromFile),
        findConfigPath: vi.fn(async () => null),
    } as unknown as MockedConfigLoader;
}

export type MockedFormatter = IOutputFormatter & { [K in keyof IOutputFormatter]: Mock };

export function makeMockFormatter(overrides: Partial<IOutputFormatter> = {}): MockedFormatter {
    const stub = makeStubFormatter();
    return {
        ...stub,
        formatQueryResult: vi.fn(stub.formatQueryResult),
        formatValidationResult: vi.fn(stub.formatValidationResult),
        formatStalenessResult: vi.fn(stub.formatStalenessResult),
        formatTraceResult: vi.fn(stub.formatTraceResult),
        formatConfig: vi.fn(stub.formatConfig),
        formatDoctorResult: vi.fn(stub.formatDoctorResult),
        formatSuccess: vi.fn(stub.formatSuccess),
        formatError: vi.fn(stub.formatError),
        ...overrides
    } as unknown as MockedFormatter;
}

export type MockedAtomRepository = ReturnType<typeof makeStubAtomRepository> & { [K in keyof ReturnType<typeof makeStubAtomRepository>]: Mock };

export function makeMockAtomRepository(overrides: Partial<AtomRepository> = {}): MockedAtomRepository {
    const stub = makeStubAtomRepository(overrides);
    const mock = { 
        ...stub, 
        find: vi.fn(stub.find), 
        findByIds: vi.fn(stub.findByIds),
        findById: vi.fn(async (id: string | { id: string; protocol?: string }, opts: unknown) => {
            const identity = typeof id === 'string' ? { id } : id;
            const results = await (mock.findByIds as unknown as Mock)([identity], opts);
            return results?.[0] || null;
        }),
        getAtomDrift: vi.fn(stub.getAtomDrift),
        getHeadHash: vi.fn(stub.getHeadHash)
    } as unknown as MockedAtomRepository;
    return mock;
}

export type MockedPrompt = IPrompt & { [K in keyof IPrompt]: Mock };

export function makeMockPrompt(overrides: Partial<IPrompt> = {}): MockedPrompt {
    const stub = makeStubPrompt(overrides);
    return {
        ...stub,
        askConfirm: vi.fn(stub.askConfirm),
        askChoice: vi.fn(stub.askChoice),
        askText: vi.fn(stub.askText || (async () => '')),
        askMultiline: vi.fn(stub.askMultiline || (async () => '')),
        close: vi.fn(stub.close || (() => {})),
    } as unknown as MockedPrompt;
}

import type { ICommitInputReader } from '../../src/engine/interfaces/commit-input-reader.js';

export type MockedInputResolver = ICommitInputReader & { resolve: Mock; read: Mock };

export function makeMockInputResolver(overrides: Partial<ICommitInputReader> = {}): MockedInputResolver {
    return {
        resolve: vi.fn().mockResolvedValue({}),
        read: vi.fn().mockResolvedValue({ subject: 'test', trailers: new Map() }),
        ...overrides
    } as unknown as MockedInputResolver;
}

export function makeMockProtocolContext(overrides: Partial<ProtocolDefinition> = {}): ProtocolContext {
    return makeStubProtocolContext(overrides);
}

/** Helper to create a REAL AtomRepository instance with mocks/stubs injected. */
export function createMockAtomRepository(deps: {
    gitClient?: IGitClient;
    protocolRegistry?: ProtocolRegistry;
    queryCache?: IQueryCache;
    baseTarget?: QueryTargetAST;
} = {}) {
    return makeAtomRepository(deps);
}

/** Mock logger that captures all output for inspection. */
export class TestLogger implements ILogger {
    public readonly level: LogLevel = LogLevel.INFO;
    public logs: string[] = [];
    public infoLogs: string[] = [];
    public results: string[] = [];
    public resultLogs: string[] = [];
    public warnings: string[] = [];
    public errors: string[] = [];

    trace() {}
    debug() {}
    info(msg: string) { 
        this.logs.push(msg); 
        this.infoLogs.push(msg);
    }
    warn(msg: string) { this.warnings.push(msg); }
    error(msg: string) { this.errors.push(msg); }
    result(msg: string) { 
        this.results.push(msg); 
        this.resultLogs.push(msg);
    }
    child() { return this; }
}

// Re-exports of foundational test data/types from the SDK
export { 
    createProtocolContext, 
    makeAtom, 
    makeQueryTarget, 
    makeRawCommit, 
    type ProtocolContext,
    type ProtocolDefinition,        ProtocolMap,
    type ProtocolState,
TEST_ENGINE_CONFIG};

import { QueryOptions } from '../../src/engine/core/types/query.js';

/** Helper to create query/search options for tests. */
export function makeQueryOptions(overrides: Partial<QueryOptions> = {}): QueryOptions {
    return makeStubQueryOptions(overrides);
}
