import { vi } from 'vitest';

import type { ProtocolContext,ProtocolDefinition } from '../../src/engine/core/types/protocol-definition.js';
import type { ICommitInputReader } from '../../src/engine/interfaces/commit-input-reader.js';
import type { IGitClient } from '../../src/engine/interfaces/git-client.js';
import { type ILogger,LogLevel } from '../../src/engine/interfaces/logger.js';
import type { IOutputFormatter } from '../../src/engine/interfaces/output-formatter.js';
import type { IPrompt } from '../../src/engine/interfaces/prompt.js';
import type { IQueryCache } from '../../src/engine/interfaces/query-cache.js';
import type { EngineInfra } from '../../src/engine/services/engine-bootstrapper.js';
import { 
    createProtocolContext,
    makeAtom,
    makeQueryTarget,
    makeRawCommit,
    makeStubConfigLoader, 
    makeStubFormatter,
    makeStubGitClient, 
    makeStubPrompt, 
    makeStubProtocolContext,
    makeStubProtocolMap, 
    makeStubQueryCache,
    makeStubQueryOptions,
    ProtocolMap,
    type ProtocolState,
    TEST_ENGINE_CONFIG} from '../../src/engine/testing.js';
import { 
    MockedConfigLoader,
    MockedGitClient,
    MockedInputResolver,
    MockedOutputFormatter,
    MockedPrompt,
    MockedQueryCache} from '../mock-types.js';

/**
 * =============================================================================
 * VITEST MOCK HARNESS (PRIVATE)
 * =============================================================================
 * Standard naming: makeMock[Type] always returns a Vitest spy-wrapped object.
 * They delegate to the framework-agnostic stubs in src/engine/testing.ts.
 */

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

export function makeMockProtocolMap(protocols: ProtocolContext[] = []): ProtocolMap<ProtocolContext> {
    return makeStubProtocolMap(protocols);
}

export function makeMockQueryCache(overrides: Partial<IQueryCache> = {}): MockedQueryCache {
    const stub = makeStubQueryCache(overrides);
    return {
        ...stub,
        get: vi.fn(stub.get),
        set: vi.fn(stub.set),
        prune: vi.fn(stub.prune)
    } as unknown as MockedQueryCache;
}

export function makeMockConfigLoader(overrides: Partial<import('../../src/engine/interfaces/config-loader.js').IConfigLoader<unknown>> = {}): MockedConfigLoader {
    const stub = makeStubConfigLoader(overrides);
    return { 
        ...stub, 
        loadForPath: vi.fn(stub.loadForPath),
        loadFromFile: vi.fn(stub.loadFromFile),
        findConfigPath: vi.fn(async () => null),
    } as unknown as MockedConfigLoader;
}

export function makeMockFormatter(overrides: Partial<IOutputFormatter> = {}): MockedOutputFormatter {
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
    } as unknown as MockedOutputFormatter;
}

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

export function makeMockInputResolver(overrides: Partial<ICommitInputReader> = {}): MockedInputResolver {
    const stub = { 
        resolve: vi.fn().mockResolvedValue({}), 
        read: vi.fn().mockResolvedValue({ subject: 'test', trailers: new Map() }) 
    };
    return {
        ...stub,
        ...overrides
    } as unknown as MockedInputResolver;
}

export function makeMockProtocolContext(overrides: Partial<ProtocolDefinition> = {}): ProtocolContext {
    return makeStubProtocolContext(overrides);
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

/** Helper to create a fully mocked Infrastructure Bag. */
export function makeMockInfra(overrides: Partial<EngineInfra> = {}): EngineInfra {
    return {
        git: makeMockGitClient(),
        cache: makeMockQueryCache(),
        protocols: makeMockProtocolMap(),
        config: TEST_ENGINE_CONFIG,
        logger: new TestLogger(),
        prompt: makeMockPrompt(),
        getFormatter: () => makeMockFormatter(),
        protocolRoot: '/mock-repo',
        cwd: '/mock-repo',
        baseTarget: makeQueryTarget(),
        ...overrides
    } as EngineInfra;
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
