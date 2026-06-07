import { existsSync, mkdirSync } from 'node:fs';

import { normalizeTrailers } from './core/logic/normalization.js';
import { authorizeKey, isBucketOwner,ownsKey } from './core/logic/ownership.js';
import { 
    createProtocolContext,
    getAuthorizedKeys,
    getFormattableDefinitions,
    getListKeys,
    getReferenceKeys,
    getScalarKeys,
    isCoreTrailer} from './core/logic/protocols.js';
import { ProtocolMap } from './core/models/protocol-map.js';
import type { CommitInput } from './core/types/commit.js';
import type { EngineConfig, TrailerDefinition,TrailerUiColor, TrailerUiKind } from './core/types/config.js';
import type { Atom, ProtocolState } from './core/types/domain.js';
import type { ProtocolContext,ProtocolDefinition } from './core/types/protocol-definition.js';
import type { QueryTargetAST, SearchOptions } from './core/types/query.js';
import type { RawCommit as IGitRawCommit } from './interfaces/git-client.js';
import { AtomRepository } from './services/atom-repository.js';
import { ProtocolRegistry } from './services/protocol-registry.js';
import { ProtocolLoader } from './shell/fs/protocol-loader.js';

export { 
    authorizeKey,
    createProtocolContext,
    getAuthorizedKeys,
    getFormattableDefinitions,
    getListKeys,
    getReferenceKeys,
    getScalarKeys,
    isBucketOwner,
    isCoreTrailer,
    normalizeTrailers,
    ownsKey};

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
  follow: { maxDepth: 3 },
  cli: { updateCheck: false, cache: true, queryCache: true, queryCachePruneThreshold: 100 },
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

/** Standard ProtocolRegistry factory for tests. */
export function makeStubProtocolRegistry(protocols: ProtocolContext[] = []): ProtocolRegistry {
  const registry = new ProtocolRegistry();
  for (const p of protocols) {
    registry.register(p);
  }
  return registry;
}

/** Helper to create a raw commit object. */
export function makeRawCommit(overrides: any = {}): IGitRawCommit {
    const hash = overrides.hash || 'h1';
    const id = overrides.id || 'a1b2c3d4';
    const trailers = overrides.trailers !== undefined ? overrides.trailers : `${TEST_ID_KEY}: ${id}`;
  
    return {
      hash,
      author: overrides.author || 'alice',
      date: overrides.date || new Date().toISOString(),
      subject: overrides.subject || 'feat: test',
      body: overrides.body || 'body content',
      trailers,
      filesChanged: overrides.filesChanged || overrides.files || [],
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
export function makeStubGitClient(overrides: any = {}) {
  return {
    getRepoRoot: async () => '/mock-repo',
    resolveRef: async () => 'head-hash',
    resolveDate: async (d: string) => new Date(d),
    log: async () => [],
    query: async () => [],
    blame: async () => [],
    getCommitsByHashes: async () => [],
    getFilesChangedSince: async () => [],
    commit: async () => ({ hash: 'new-hash', message: 'commit msg', success: true }),
    hasStagedChanges: async () => true,
    isInsideRepo: async () => true,
    getHeadMessage: async () => 'feat: head',
    getFilesChanged: async () => new Map(),
    ...overrides,
  };
}

/** Stub Atom Repository. */
export function makeStubAtomRepository(overrides: any = {}) {
    return {
        find: async () => [],
        findByIds: async () => [],
        findById: async () => null,
        findByCommitHash: async () => null,
        getAtomDrift: async () => ({}),
        getHeadHash: async () => 'head-hash',
        ...overrides
    };
}

/** Stub Formatter for CLI tests. */
export function makeStubFormatter() {
    return {
        formatQueryResult: () => 'Mock Query Result',
        formatValidationResult: () => 'Mock Validation Result',
        formatStalenessResult: () => 'Mock Staleness Result',
        formatTraceResult: () => 'Mock Trace Result',
        formatConfigResult: () => 'Mock Config Result',
        formatConfig: () => 'Mock Config Result',
        formatDoctorResult: () => 'Mock Doctor Result',
        formatSuccess: (msg: string) => `Success: ${msg}`,
        formatError: (msg: string) => `Error: ${msg}`,
    };
}

/** Stub Config Loader. */
export function makeStubConfigLoader(overrides: any = {}) {
    return {
        loadForPath: async () => TEST_ENGINE_CONFIG,
        ...overrides
    };
}

/** Stub Query Cache. */
export function makeStubQueryCache(overrides: any = {}) {
    return {
        get: async () => null,
        set: async () => {},
        prune: async () => {},
        ...overrides
    };
}

/** Stub Search Options. */
export function makeStubSearchOptions(overrides: Partial<SearchOptions> = {}): SearchOptions {
    return {
        filters: [],
        follow: false,
        cache: true,
        ...overrides
    };
}

/** Helper to create a REAL AtomRepository instance with stubs. */
export function makeAtomRepository(deps: any = {}) {
    return new AtomRepository(
        deps.gitClient || makeStubGitClient(),
        deps.protocolRegistry || deps.registry || new ProtocolRegistry(),
        deps.queryCache || deps.cache || { get: async () => null, set: async () => {} },
        deps.baseTarget || makeQueryTarget()
    );
}

/** Factory to create a stub for interactive prompts. */
export function makeStubPrompt(overrides: any = {}) {
    return {
        askConfirm: async () => true,
        askChoice: async () => '',
        askInput: async () => '',
        ...overrides
    };
}

/** Atom Factory for high-level logic tests. */
export function makeAtom(overrides: any = {}): Atom {
    const protocols = new ProtocolMap<ProtocolState>();
    
    if (overrides.protocols) {
        const entries: [string, any][] = (overrides.protocols instanceof Map) 
            ? Array.from(overrides.protocols.entries()) 
            : Object.entries(overrides.protocols);
            
        for (const [name, state] of entries) {
            protocols.set(name.toLowerCase(), {
                trailers: {},
                unauthorized: {},
                ...state
            } as ProtocolState);
        }
    } else {
        const id = overrides.id || 'a1b2c3d4';
        const rawTrailers = overrides.trailers || { [TEST_ID_KEY]: [id] };
        protocols.set('mock', {
            trailers: rawTrailers,
            unauthorized: {}
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
export function makeCommitInput(overrides: any = {}): CommitInput {
    const { trailers: rawTrailers, ...rest } = overrides;
    const trailers = new Map<string, Record<string, string[]>>();
    
    if (rawTrailers) {
        const entries: [string, any][] = (rawTrailers instanceof Map) 
            ? Array.from(rawTrailers.entries()) 
            : Object.entries(rawTrailers);
            
        for (const [p, t] of entries) {
            trailers.set(p.toLowerCase(), t as Record<string, string[]>);
        }
    }
    
    return {
        subject: rest.subject || 'feat: test',
        body: rest.body || '',
        ...rest,
        trailers,
    };
}
