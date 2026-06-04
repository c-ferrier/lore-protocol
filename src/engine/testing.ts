import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ProtocolMap, type ProtocolName } from './core/models/protocol-map.js';
import { ActiveProtocol } from './core/models/active-protocol.js';
import { ProtocolRegistry } from './services/protocol-registry.js';
import { ProtocolLoader } from './shell/fs/protocol-loader.js';
import { TriggerParser, parseTriggerHints } from './util/trigger-parser.js';
import { 
    getDiscoveryPatterns, 
    getSearchPatterns, 
    claimsTrailers 
} from './shell/git/protocol-query-adapter.js';
import type { ProtocolDefinition, IIdentityResolver, IProtocol } from './core/types/protocol-definition.js';
import type { EngineConfig, TrailerUiKind, TrailerUiColor, TrailerDefinition, StaleIfCondition } from './core/types/config.js';
import type { ProtocolState, Atom, SupersessionStatus, StaleReason, Trailers, HierarchicalTrailers } from './core/types/domain.js';
import type { CommitInput } from './core/types/commit.js';
import type { FormattableQueryResult, FormattableValidationResult, FormattableStalenessResult, FormattableTraceResult, FormattableConfigResult, FormattableDoctorResult, FormattableTrailerDefinition } from './core/types/output.js';
import type { QueryTargetAST, QueryIdentity, QualifiedFilter, FilterOperator, SearchOptions } from './core/types/query.js';
import type { RawCommit } from './interfaces/git-client.js';
import { 
    GLOBAL_CACHE_KEY, 
    ENGINE_CONFIG_FILENAME, 
    ENGINE_DIR_NAME, 
    STALE_SIGNAL 
} from './util/constants.js';

import { 
    createProtocolContext,
    getAuthorizedKeys,
    getScalarKeys,
    getListKeys,
    getReferenceKeys,
    isCoreTrailer,
    getFormattableDefinitions
} from './core/logic/protocols.js';
import { authorizeKey, ownsKey, isBucketOwner } from './core/logic/ownership.js';
import { normalizeTrailers } from './core/logic/normalization.js';

export { 
    createProtocolContext,
    getAuthorizedKeys,
    getScalarKeys,
    getListKeys,
    getReferenceKeys,
    isCoreTrailer,
    getFormattableDefinitions,
    authorizeKey,
    ownsKey,
    isBucketOwner,
    normalizeTrailers
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

/** Helper: returns a REAL ActiveProtocol instance. */
export function makeProtocol(
    overrides: Partial<ProtocolDefinition> = {},
    configOverrides: any = {}
): ActiveProtocol {
    const name = overrides.name || configOverrides.name || 'Mock';
    
    // 1. Prepare Base Schema (Isolation: don't inject mock trailers if custom ones provided)
    const trailers = { ...(overrides.trailers ?? TEST_PROTOCOL_DEFINITION.trailers) };
    
    // 2. Ensure identity key is in the schema to prevent normalization failures
    const identityKey = overrides.identityKey || TEST_PROTOCOL_DEFINITION.identityKey;
    if (!trailers[identityKey]) {
        trailers[identityKey] = { description: 'ID', multivalue: false, validation: 'none' } as any;
    }

    const baseDef = { 
        ...TEST_PROTOCOL_DEFINITION, 
        ...overrides, 
        name,
        identityKey,
        trailers
    };

    // 3. Prepare Config Override (Strip name to prevent accidental registry collisions)
    const { name: _ignoredName, ...safeConfig } = configOverrides;

    const finalized = ProtocolLoader.applyOverrides([baseDef as any], { 
        [name.toLowerCase()]: safeConfig
    })[0];
    
    return new ActiveProtocol(finalized);
}

/** Helper: returns a REAL ProtocolRegistry instance. */
export function makeProtocolRegistry(protocols: ProtocolDefinition[] = []): ProtocolRegistry {
  const registry = new ProtocolRegistry();
  for (const p of protocols) {
    registry.register(p);
  }
  return registry;
}

/** Helper to create a ProtocolDefinition with deep partial overrides. */
export function makeProtocolDefinition(overrides: Partial<ProtocolDefinition> = {}): ProtocolDefinition {
  return {
    ...TEST_PROTOCOL_DEFINITION,
    ...overrides,
    trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...(overrides.trailers || {}) },
  };
}

/** Legacy/Compatibility shims for older tests. */
export class ProtocolInterpreter {
    constructor(public p: ActiveProtocol) {}
    normalize(raw: any, claimed?: any) { 
        return this.p.normalize(raw, claimed); 
    }
    getIdentity(state: any) { 
        const id = this.p.getIdentity(state);
        if (!id) return null;
        return this.p.storageNamespace !== '' ? `${this.p.storageNamespace}/${id}` : id;
    }
    getStaleSignals(atom: any, now: Date, map: any) { return this.p.getStaleSignals(atom, now, map); }
    getDiscoveryPatterns() { return this.p.getDiscoveryPatterns(); }
    getSearchPatterns(f: any) { return this.p.getSearchPatterns(f); }
    claims(raw: string) { return this.p.claims(raw); }
    isRoot() { return this.p.isRoot; }
}

export class ProtocolValidator {
    constructor(public p: ActiveProtocol) {}
    validateState(state: any, resolver?: any) { return this.p.validateState(state, resolver); }
    validateTrailer(key: string, val: string, resolver?: any) { return this.p.validateTrailer(key, val, resolver); }
}

export class ProtocolSchema extends ActiveProtocol {
    constructor(definitions: Map<string, any>, caseMap: Map<string, string>, permissive: boolean) {
        const trailers: Record<string, TrailerDefinition> = {};
        for (const [k, v] of definitions.entries()) trailers[k] = v;
        super({
            name: 'Schema',
            version: '1.0',
            namespace: '',
            identityKey: 'Mock-id',
            strict: !permissive,
            permissive,
            trailers
        });
    }
    getUiKind(k: string) { return (this.getDefinition(k)?.ui?.kind || 'custom') as any; }
    getUiColor(k: string) { return (this.getDefinition(k)?.ui?.color || 'cyan') as any; }
}

/** Passive Data Stubs. */
export function makeTrailers(overrides: Record<string, string[]> = {}): Trailers {
  return { ...overrides };
}

export function makeAtom(overrides: any = {}): Atom {
    let protocols = overrides.protocols || new ProtocolMap<ProtocolState>();
    
    // Legacy support: if trailers provided but protocols not explicitly structured
    if (overrides.trailers && !overrides.protocols) {
        const pName = (overrides.protocol || 'mock').toLowerCase();
        const trailers = overrides.trailers;
        const state: ProtocolState = { trailers, unauthorized: {} };
        protocols = new ProtocolMap<ProtocolState>();
        protocols.set(pName, state);
    }

    if (!(protocols instanceof Map)) {
        const map = new ProtocolMap<ProtocolState>();
        for (const [k, v] of Object.entries(protocols)) {
            map.set(k, v as ProtocolState);
        }
        protocols = map;
    }

    const atom: Atom = {
        commitHash: overrides.commitHash || 'h1',
        author: overrides.author || 'alice',
        date: overrides.date || new Date(),
        subject: overrides.subject || 'feat: test',
        body: overrides.body || '',
        filesChanged: overrides.filesChanged || [],
        ...overrides,
        protocols,
    };
    return atom;
}

export function makeRawCommit(overrides: any = {}): RawCommit {
  const hash = overrides.hash || 'h1';
  const id = overrides.id || 'a1b2c3d4';
  const trailers = overrides.trailers !== undefined ? overrides.trailers : `${TEST_ID_KEY}: ${id}`;

  return {
    hash,
    author: overrides.author || 'alice',
    date: overrides.date || new Date().toISOString(),
    subject: overrides.subject || 'feat: test',
    body: overrides.body || 'body content',
    filesChanged: overrides.filesChanged || [],
    trailers,
  };
}

export function makeCommitInput(overrides: Partial<CommitInput> = {}): CommitInput {
  let trailers = overrides.trailers || new Map();
  if (!(trailers instanceof Map)) {
      trailers = new Map(Object.entries(trailers));
  }
  return {
    subject: overrides.subject || 'feat: test',
    body: overrides.body || 'body',
    ...overrides,
    trailers: trailers as HierarchicalTrailers,
  };
}

export function makeQueryTarget(val: string | string[] = 'src/auth.ts'): QueryTargetAST {
    if (Array.isArray(val)) return { type: 'path', resolvedPaths: val, raw:val };
    if (typeof val === 'string' && val.includes(':')) {
        const [path, range] = val.split(':');
        const [start, end] = range.split('-').map(Number);
        return { type: 'line-range', lineRange: {file:path, start, end}, raw:val, resolvedPaths: [path] };
    }
    return { type: 'path', resolvedPaths: [val as string], raw:val };
}

/** Stub factories for service-layer testing. */
export function makeStubGitClient(overrides: any = {}): any {
    return {
        query: async () => [],
        resolveDate: async (d: string) => new Date(d),
        getCommitsByHashes: async () => [],
        getBlame: async () => [],
        resolveRef: async () => 'head-hash',
        getRepoRoot: async () => '/mock-repo',
        ...overrides
    };
}

export function makeStubPrompt(overrides: any = {}): any {
    return {
        askConfirm: async () => true,
        askChoice: async () => '',
        askInput: async () => '',
        ...overrides
    };
}

export function makeStubProtocol(overrides: any = {}): any {
    const name = (overrides.name || 'Mock').toLowerCase();
    const storageNamespace = overrides.getStorageNamespace ? overrides.getStorageNamespace() : (overrides.namespace || '');
    
    const p = makeProtocol({
        ...overrides,
        name,
        namespace: storageNamespace
    });
    return p;
}

export function makeStubAtomRepository(overrides: any = {}): any {
    return {
        find: async () => [],
        findById: async () => null,
        findByIds: async () => [],
        ...overrides
    };
}

export function makeStubValidator(overrides: any = {}): any {
    return {
        validate: async () => [],
        ...overrides
    };
}

export function makeStubStalenessDetector(overrides: any = {}): any {
    return {
        detect: async () => [],
        ...overrides
    };
}

export function makeStubProtocolRegistry(overrides: any = {}): any {
    return {
        get: () => null,
        all: () => [],
        register: () => {},
        ...overrides
    };
}

export function makeStubConfigLoader(overrides: any = {}): any {
    return {
        load: async () => TEST_ENGINE_CONFIG,
        ...overrides
    };
}
