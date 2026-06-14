import { existsSync, mkdirSync } from 'node:fs';

import { normalizeTrailers } from './core/logic/normalization.js';
import { authorizeKey, isBucketOwner,ownsKey } from './core/logic/ownership.js';
import { 
    createProtocolContext,
    getAuthorizedKeys,
    getFormattableDefinitions,
    getListKeys,
    getReferenceKeys,
    getRootProtocol,
    getScalarKeys,
    isCoreTrailer} from './core/logic/protocols.js';
import { ProtocolMap } from './core/models/protocol-map.js';
import type { CommitInput } from './core/types/commit.js';
import type { EngineConfig, TrailerDefinition,TrailerUiColor, TrailerUiKind } from './core/types/config.js';
import type { Atom, ProtocolState } from './core/types/domain.js';
import type { ProtocolContext,ProtocolDefinition } from './core/types/protocol-definition.js';
export type { ProtocolContext,ProtocolDefinition };
import type { QueryOptions,QueryTargetAST } from './core/types/query.js';
import type { IConfigLoader } from './interfaces/config-loader.js';
import type { IGitClient, RawCommit as IGitRawCommit, StorageQuery } from './interfaces/git-client.js';
import type { IIdentityIndex } from './interfaces/identity-index.js';
import type { ILogger } from './interfaces/logger.js';
import type { ErrorMessage } from './interfaces/output-formatter.js';
import type { IOutputFormatter } from './interfaces/output-formatter.js';
import type { IPrompt } from './interfaces/prompt.js';
import type { IQueryCache } from './interfaces/query-cache.js';
import type { EngineInfra } from './services/engine-bootstrapper.js';
import { ProtocolLoader } from './shell/fs/protocol-loader.js';

export { 
    authorizeKey,
    createProtocolContext,
    getAuthorizedKeys,
    getFormattableDefinitions,
    getListKeys,
    getReferenceKeys,
    getRootProtocol,
    getScalarKeys,
    isBucketOwner,
    isCoreTrailer,
    normalizeTrailers,
    ownsKey,
    ProtocolMap};

export type { ProtocolState };

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
  validation: { maxMessageLines: 50, subjectMaxLength: 50 },
  stale: { olderThan: '6m', driftThreshold: 20 },
  output: { defaultFormat: 'text' },
  follow: { maxDepth: 5 },
  cache: { query: true, identity: true, pruneThreshold: 100 },
  cli: { updateCheck: false },

  protocols: {},
};

/** A generic root, permissive protocol schema definition. */
export const TEST_PROTOCOL_DEFINITION: ProtocolDefinition = {
  name: 'Mock',
  version: '1.0',
  namespace: '',
  strict: true,
  permissive: false,
  identityKey: TEST_ID_KEY,
  trailers: {
    [TEST_ID_KEY]: {
      description: 'Stable identity.', multivalue: false, validation: 'pattern',
      pattern: '^[0-9a-f]{8}$', generator: 'hex8', required: true, isCore: true,
      ui: { kind: 'identity' as TrailerUiKind, color: 'dim' as TrailerUiColor },
      prompt: { order: 0 }
    }
  }
};

/** Standard core-like trailers for tests that need them. */
export const MOCK_CORE_TRAILERS: Record<string, TrailerDefinition> = {
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
    'Supersedes': {
      description: 'Superseded reference.', multivalue: true, validation: 'reference', isCore: true,
      ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
      prompt: { order: 210 }
    }
};

/** 
 * Authoritative ProtocolContext factory for tests. 
 * Framework-agnostic.
 */
export function makeStubProtocolContext(
    overrides: Partial<ProtocolDefinition> = {},
    configOverrides: Partial<ProtocolDefinition> = {}
): ProtocolContext {
    const name = overrides.name || configOverrides.name || 'Mock';
    const trailers = { ...(overrides.trailers ?? TEST_PROTOCOL_DEFINITION.trailers) };
    const identityKey = overrides.identityKey || TEST_PROTOCOL_DEFINITION.identityKey;
    
    if (!trailers[identityKey]) {
        trailers[identityKey] = { description: 'ID', multivalue: false, validation: 'none', isCore: true };
    }

    const baseDef = { 
        ...TEST_PROTOCOL_DEFINITION, 
        ...overrides, 
        name,
        identityKey,
        trailers
    };

    const finalized = ProtocolLoader.applyOverrides([baseDef as ProtocolDefinition], { 
        [name.toLowerCase()]: configOverrides
    })[0];
    
    return createProtocolContext(finalized);
}

/** Stub Protocol State factory for tests. */
export function makeStubProtocolState(overrides: Partial<ProtocolState> = {}): ProtocolState {
    return {
        trailers: overrides.trailers || {},
        unauthorized: overrides.unauthorized || {},
        invalidReferences: overrides.invalidReferences || {},
        ...overrides
    };
}

/** Standard ProtocolMap factory for tests. */
export function makeStubProtocolMap(): ProtocolMap<ProtocolContext>;
export function makeStubProtocolMap<T>(items: (T | [string, T])[]): ProtocolMap<T>;
export function makeStubProtocolMap(items: unknown[] = []): ProtocolMap<unknown> {
  const map = new ProtocolMap<unknown>();
  for (const item of items) {
    if (Array.isArray(item)) {
        // [string, T] format (ProtocolState)
        map.set(item[0].toLowerCase(), item[1]);
    } else if (item && typeof item === 'object') {
        // T format (ProtocolContext)
        const p = item as { name?: string; def?: { name: string } };
        const name = p.name || p.def?.name || 'unknown';
        map.set(name.toLowerCase(), p);
    }
  }
  return map;
}

let commitCounter = 0;
/**
 * Helper to create a raw commit object for mocking history.
 */
export function makeRawCommit(overrides: Partial<IGitRawCommit> & { id?: string; message?: string } = {}): IGitRawCommit {
    commitCounter++;
    const hash = overrides.hash || `h${commitCounter}`;

    const id = overrides.id || 'a1b2c3d4';
    const trailers = overrides.trailers !== undefined ? overrides.trailers : `${TEST_ID_KEY}: ${id}`;
    
    const subject = overrides.subject || (overrides.message ? overrides.message.split('\n')[0] : 'feat: test');
    const body = overrides.body || (overrides.message ? overrides.message.split('\n').slice(2).join('\n') : 'body content');
  
    return {
      hash,
      author: overrides.author || 'alice',
      date: overrides.date || new Date().toISOString(),
      subject,
      body,
      trailers,
      filesChanged: overrides.filesChanged || [],
    };
}

/** Helper to create a QueryTargetAST. */
export function makeQueryTarget(val: string | string[] | Partial<QueryTargetAST> = 'all'): QueryTargetAST {
    if (Array.isArray(val)) return { type: 'path', resolvedPaths: val, raw: String(val) };
    
    if (typeof val === 'string') {
        if (val === 'all') return { type: 'global', raw: 'all', resolvedPaths: [] };
        if (val.includes(':')) {
            const [path, range] = val.split(':');
            const [start, end] = range.split('-').map(Number);
            return { type: 'line-range', lineRange: { file: path, start, end }, raw: val, resolvedPaths: [path] };
        }
        return { type: 'path', resolvedPaths: [val], raw: val };
    }
    
    return {
        type: 'global',
        raw: 'all',
        resolvedPaths: [],
        ...val
    } as QueryTargetAST;
}

/** Stub Git Client for I/O tests. Framework-agnostic. */
export function makeStubGitClient(overrides: Partial<IGitClient> = {}): IGitClient {
  return {
    getRepoRoot: async () => '/mock-repo',
    resolveRef: async () => 'head-hash',
    resolveDate: async (d: string) => new Date(d),
    blame: async () => [],
    getLogStream: async function* () {},
    queryStream: async function* (this: IGitClient, _q: StorageQuery) {
    },
    filterAliveHashes: async (hashes: readonly string[]) => [...hashes],
    commit: async () => ({ hash: 'new-hash', message: 'commit msg', success: true }),
    hasStagedChanges: async () => true,
    isInsideRepo: async () => true,
    getHeadMessage: async () => 'feat: head',
    getFilesChanged: async () => new Map(),
    ...overrides,
  } as IGitClient;
}

/** Stub Formatter for CLI tests. */
export function makeStubFormatter(): IOutputFormatter {
    return {
        formatQueryResult: () => 'Mock Query Result',
        formatValidationResult: () => 'Mock Validation Result',
        formatStalenessResult: () => 'Mock Staleness Result',
        formatTraceResult: () => 'Mock Trace Result',
        formatConfigResult: () => 'Mock Config Result',
        formatDoctorResult: () => 'Mock Doctor Result',
        formatSuccess: (msg: string) => `Success: ${msg}`,
        formatError: (_code: number, messages: readonly ErrorMessage[]) => `Error: ${messages[0]?.message}`,
        formatHeader: (target: string, type: string, _visibleTrailers?: readonly string[] | 'all') => `Mock Header: ${target} (${type})`,
        formatAtom: (atom: Atom, _visibleTrailers?: readonly string[] | 'all') => `Mock Atom: ${atom.commitHash}`,
        formatFooter: () => 'Mock Footer',
    };
}


/** Stub Config Loader. */
export function makeStubConfigLoader(overrides: Partial<IConfigLoader> = {}): IConfigLoader {
    return {
        loadForPath: async () => TEST_ENGINE_CONFIG,
        loadFromFile: async () => TEST_ENGINE_CONFIG,
        findConfigPath: async () => null,
        ...overrides
    } as IConfigLoader;
}

/** Stub Query Cache. */
export function makeStubQueryCache(overrides: Partial<IQueryCache> = {}): IQueryCache {
    return {
        get: async () => null,
        set: async () => {},
        prune: async () => {},
        clear: async () => {},
        ...overrides
    } as IQueryCache;
}

/** Stub Identity Index. */
export function makeStubIdentityIndex(overrides: Partial<IIdentityIndex> = {}): IIdentityIndex {
    return {
        get: async () => [],
        append: async () => {},
        clear: async () => {},
        ...overrides
    };
}

/** Stub Query Options. */
export function makeStubQueryOptions(overrides: Partial<QueryOptions> = {}): QueryOptions {
    return {
        filters: [],
        follow: false,
        cache: true,
        ...overrides
    };
}

/** Factory to create a stub for interactive prompts. */
export function makeStubPrompt(overrides: Partial<IPrompt> = {}): IPrompt {
    return {
        askConfirm: async () => true,
        askChoice: async <T extends string>(_m: string, choices: readonly T[]) => choices[0],
        askInput: async () => '',
        ...overrides
    } as IPrompt;
}

/** Stub Logger. */
export function makeStubLogger(): ILogger {
    return {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        result: () => {},
    } as unknown as ILogger;
}

/** Helper to create a stub Infrastructure Bag. */
export function makeStubInfra(overrides: Partial<EngineInfra> = {}): EngineInfra {
    return {
        git: makeStubGitClient(),
        cache: makeStubQueryCache(),
        identityIndex: makeStubIdentityIndex(),
        protocols: makeStubProtocolMap(),
        config: TEST_ENGINE_CONFIG,
        logger: makeStubLogger(),
        prompt: makeStubPrompt(),
        getFormatter: () => makeStubFormatter(),
        protocolRoot: '/mock-repo',
        cwd: '/mock-repo',
        baseTarget: makeQueryTarget(),
        ...overrides
    } as EngineInfra;
}

/** Atom Factory for high-level logic tests. */
export function makeAtom(overrides: Partial<Atom> & { id?: string; trailers?: Record<string, string[]> } = {}): Atom {
    const protocols = new ProtocolMap<ProtocolState>();
    
    if (overrides.protocols) {
        const entries = (overrides.protocols instanceof Map) 
            ? Array.from(overrides.protocols.entries()) 
            : Object.entries(overrides.protocols);
            
        for (const [name, state] of entries) {
            protocols.set(name.toLowerCase(), {
                trailers: {},
                unauthorized: {},
                invalidReferences: {},
                ...(state as object)
            } as ProtocolState);
        }
    } else {
        const id = overrides.id || 'a1b2c3d4';
        const rawTrailers = overrides.trailers || { [TEST_ID_KEY]: [id] };
        protocols.set('mock', {
            trailers: rawTrailers,
            unauthorized: {},
            invalidReferences: {}
        });
    }

    return {
        commitHash: overrides.commitHash || 'h1',
        date: overrides.date || new Date(),
        author: overrides.author || 'alice',
        subject: overrides.subject || 'feat: test',
        body: overrides.body || '',
        rawTrailers: overrides.rawTrailers || `${TEST_ID_KEY}: ${overrides.id || 'a1b2c3d4'}`,
        filesChanged: overrides.filesChanged || [],
        protocols,
    };
}

/** Helper to create a CommitInput. */
export function makeCommitInput(overrides: Partial<CommitInput> = {}): CommitInput {
    return {
        subject: overrides.subject || 'feat: test',
        body: overrides.body || '',
        trailers: overrides.trailers || new ProtocolMap<Record<string, string[]>>(),
    };
}
