import { vi } from 'vitest';

import type { ProtocolContext,ProtocolDefinition } from '../../src/engine/core/types/protocol-definition.js';
import { type ILogger,LogLevel } from '../../src/engine/interfaces/logger.js';
import type { IPrompt } from '../../src/engine/interfaces/prompt.js';
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
    makeStubSearchOptions,
    TEST_ENGINE_CONFIG} from '../../src/engine/testing.js';

/**
 * =============================================================================
 * VITEST MOCK HARNESS (PRIVATE)
 * =============================================================================
 * Standard naming: makeMock[Type] always returns a Vitest spy-wrapped object.
 * They delegate to the framework-agnostic stubs in src/engine/testing.ts.
 */

export function makeMockGitClient(overrides: any = {}): any {
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
    };
}

export function makeMockProtocolRegistry(protocols: any[] = []): any {
    const registry = makeStubProtocolRegistry(protocols);
    return registry;
}

export function makeMockQueryCache(overrides: any = {}): any {
    const stub = makeStubQueryCache(overrides);
    return {
        ...stub,
        get: vi.fn(stub.get),
        set: vi.fn(stub.set),
        prune: vi.fn(stub.prune)
    };
}

export function makeMockConfigLoader(overrides: any = {}): any {
    const stub = makeStubConfigLoader(overrides);
    return { 
        ...stub, 
        loadForPath: vi.fn(stub.loadForPath),
        findConfigPath: vi.fn(async () => null),
    };
}

export function makeMockFormatter(overrides: any = {}): any {
    const stub = makeStubFormatter();
    return {
        ...stub,
        formatQueryResult: vi.fn(stub.formatQueryResult),
        formatValidationResult: vi.fn(stub.formatValidationResult),
        formatStalenessResult: vi.fn(stub.formatStalenessResult),
        formatTraceResult: vi.fn(stub.formatTraceResult),
        formatConfigResult: vi.fn(stub.formatConfigResult),
        formatConfig: vi.fn(stub.formatConfig),
        formatDoctorResult: vi.fn(stub.formatDoctorResult),
        formatSuccess: vi.fn(stub.formatSuccess),
        formatError: vi.fn(stub.formatError),
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
        getAtomDrift: vi.fn(stub.getAtomDrift),
        getHeadHash: vi.fn(stub.getHeadHash)
    };
    return mock;
}

export function makeMockPrompt(overrides: any = {}): IPrompt {
    const stub = makeStubPrompt(overrides);
    return {
        ...stub,
        askConfirm: vi.fn(stub.askConfirm),
        askChoice: vi.fn(stub.askChoice),
        askInput: vi.fn(stub.askInput),
        askText: vi.fn(stub.askText || (async () => '')),
        askMultiline: vi.fn(stub.askMultiline || (async () => '')),
        close: vi.fn(stub.close || (() => {})),
    };
}

export function makeMockInputResolver(overrides: any = {}): any {
    return {
        resolve: vi.fn().mockResolvedValue({}),
        read: vi.fn().mockResolvedValue({ subject: 'test', trailers: new Map() }),
        ...overrides
    };
}

export function makeMockProtocolContext(overrides: any = {}): ProtocolContext {
    return makeStubProtocolContext(overrides);
}

/** Helper to create a REAL AtomRepository instance with mocks/stubs injected. */
export function createMockAtomRepository(deps: any = {}) {
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
    type ProtocolDefinition,    TEST_ENGINE_CONFIG};

import { SearchOptions } from '../../src/engine/core/types/query.js';

/** Helper to create query/search options for tests. */
export function makeQueryOptions(overrides: Partial<SearchOptions> = {}): SearchOptions {
    return makeStubSearchOptions(overrides);
}
