import { vi } from 'vitest';

import type { ProtocolContext,ProtocolDefinition } from '../../src/engine/core/types/protocol-definition.js';
import { 
    createProtocolContext,
    makeAtom,
    makeAtomRepository as realAtomRepository,
    makeMockContext as stubMockContext,
    makeProtocol as stubProtocol, 
    makeProtocolRegistry as stubProtocolRegistry, 
    makeQueryTarget,
    makeRawCommit,
    makeStubAtomRepository as stubAtomRepository, 
    makeStubConfigLoader as stubConfigLoader, 
    makeStubGitClient as stubGitClient, 
    makeStubPrompt as stubPrompt, 
    makeStubStalenessDetector as stubStalenessDetector, 
    TEST_ENGINE_CONFIG} from '../../src/engine/testing.js';

// 1. Vitest Spies (Middlemen)
// These wrap framework-agnostic stubs in Vitest mock functions.

export function makeMockGitClient(overrides: any = {}): any {
    const stub = stubGitClient(overrides);
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
        countCommitsSince: vi.fn(stub.countCommitsSince),
        log: vi.fn(stub.log),
        commit: vi.fn(stub.commit)
    };
}

export function makeMockProtocolRegistry(protocols: any[] = []): any {
    const registry = stubProtocolRegistry(protocols);
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
    const stub = stubConfigLoader(overrides);
    return { 
        ...stub, 
        loadForPath: vi.fn(stub.loadForPath),
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
        formatConfig: vi.fn().mockReturnValue(''),
        formatDoctorResult: vi.fn().mockReturnValue(''),
        formatSuccess: vi.fn().mockReturnValue(''),
        formatError: vi.fn().mockReturnValue(''),
        ...overrides
    };
}

export function makeMockAtomRepository(overrides: any = {}): any {
    const stub = stubAtomRepository(overrides);
    const mock: any = { 
        ...stub, 
        find: vi.fn(stub.find), 
        findByIds: vi.fn(stub.findByIds),
        findById: vi.fn(async (id: any, opts: any) => {
            const results = await mock.findByIds([id], opts);
            return results[0] || null;
        }),
        findByCommitHash: vi.fn(stub.findByCommitHash)
    };
    return mock;
}

export function makeMockPrompt(overrides: any = {}): any {
    const stub = stubPrompt(overrides);
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

export function makeMockProtocol(overrides: Partial<ProtocolDefinition> = {}): any {
  return stubProtocol(overrides);
}

export function makeMockProtocolContext(overrides: any = {}): ProtocolContext {
    // If the caller didn't provide a mock function but provided values, we should ideally handle it.
    // For now, we'll just wrap the stub.
    const hooks: any = {};

    return stubMockContext({ ...overrides, ...hooks });
}

// Level 2 Tests often need the real repository but with mocks injected
export function makeAtomRepository(deps: any = {}) {
    return realAtomRepository(deps);
}

/** Mock logger that captures all output for inspection. Supports multiple naming conventions. */
export class TestLogger {
    public logs: string[] = [];
    public infoLogs: string[] = [];
    public results: string[] = [];
    public resultLogs: string[] = [];
    public warnings: string[] = [];
    public errors: string[] = [];

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
}

// Named Exports for Level 2 Tests
export { 
    createProtocolContext, 
    makeAtom, 
    makeQueryTarget, 
    makeRawCommit, 
    TEST_ENGINE_CONFIG};

/** Helper to create search options. */
export function makeSearchOptions(overrides: any = {}): any {
    return {
        filters: [],
        follow: false,
        cache: true,
        ...overrides
    };
}

export function makeQueryOptions(overrides: any = {}): any {
    return makeSearchOptions(overrides);
}

// Shims for backward compatibility (Mock versions preferred in tests)
export const makeProtocolRegistry = makeMockProtocolRegistry;
export const makeProtocol = makeMockProtocol;
export const makeStubProtocol = (overrides: any) => stubMockContext(overrides);
export const makeStubGitClient = makeMockGitClient;
export const makeFormatter = makeMockFormatter;
export const makeConfigLoader = makeMockConfigLoader;
export const makePrompt = makeMockPrompt;
