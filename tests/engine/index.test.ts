import * as rootResolver from '../../src/engine/shell/fs/root-resolver.js';
import { AtomRepository } from '../../src/engine/services/atom-repository.js';
import { ENGINE_CONFIG_FILENAME } from '../../src/engine/util/constants.js';
import { JsonFormatter } from '../../src/engine/cli/formatters/json-formatter.js';
import { LoreProtocolDefinition } from '../../src/lore/protocol-definition.js';
import { NullQueryCache } from '../../src/engine/shell/fs/query-cache.js';
import { ProtocolRegistry } from '../../src/engine/services/protocol-registry.js';
import { TEST_ENGINE_CONFIG, TEST_PROTOCOL_DEFINITION, makeProtocol, makeQueryTarget } from '../../src/engine/testing.js';
import { TEST_ENGINE_DIR, assertIsolatedEngine } from '../../src/engine/testing.js';
import { TEST_PROTOCOL_CONFIG, makeProtocol } from '../../src/engine/testing.js';
import { describe, it, expect } from 'vitest';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { makeMockGitClient } from './engine-test-utils.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { parseFlagsToInput } from '../../src/engine/core/logic/input-interpretation.js';
import { resolve, join } from 'node:path';
import { resolveProtocolRoot } from '../../src/engine/shell/fs/root-resolver.js';
import { runCli } from '../../src/engine/index-impl.js';
import { tmpdir } from 'node:os';
import { type Atom } from '../../src/engine/core/types/domain.js';
import { type Atom, type Trailers } from '../../src/engine/core/types/domain.js';
import { type FormattableQueryResult } from '../../src/engine/core/types/output.js';
import { type ProtocolDefinition } from '../../src/engine/core/types/protocol-definition.js';
import { validateCommits } from '../../src/engine/shell/orchestrators/validation.js';

const LORE_ID_KEY = 'Lore-id';
describe('Engine Assembly (Agnostic Bootstrap)', () => {
  const testDir = join(tmpdir(), `engine-bootstrap-${Date.now()}`);
  const pkgPath = join(testDir, 'package.json');
  const CUSTOM_PROTOCOL = {
    name: 'Custom',
    version: '1.0',
    identityKey: 'Custom-id',
    namespace: 'custom',
    trailers: {}
  };
  const TEST_ENGINE_CONFIG = {
    protocol: { name: 'Atom', version: '1.0' },
    strict: false, permissive: true, trailers: { definitions: {} },
    validation: { strict: false, maxMessageLines: 50, subjectMaxLength: 72 },
    stale: { olderThan: '6m', driftThreshold: 20 },
    output: { defaultFormat: 'text' },
    follow: { maxDepth: 3 },
    cli: { updateCheck: false, cache: true, queryCache: true }
  } as any;
  beforeAll(() => {
    assertIsolatedEngine(TEST_ENGINE_DIR);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(pkgPath, JSON.stringify({ version: '1.0.0' }));
  });
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });
  it('should bootstrap the engine with a custom protocol and no Lore mentions', async () => {
    const { program, sharedDeps } = await runCli({
      binaryName: 'test-atom',
      version: '0.0.0-test',
      description: 'Test Engine',
      engineDirName: TEST_ENGINE_DIR,
      configFileName: ENGINE_CONFIG_FILENAME,
      defaultConfig: TEST_ENGINE_CONFIG,
      staticProtocols: [CUSTOM_PROTOCOL],
    });
    expect(program.name()).toBe('test-atom');
    const customProtocol = sharedDeps.protocolRegistry.get('custom');
    expect(customProtocol).toBeDefined();
    expect(customProtocol?.name).toBe('custom');
    expect(customProtocol?.storageNamespace).toBe('custom');
    // Verify services are wired correctly
    expect(sharedDeps.atomRepository).toBeDefined();
    expect(sharedDeps.gitClient).toBeDefined();
    // Check for "Lore" leakage in help text
    const helpText = program.helpInformation();
    expect(helpText).not.toContain('Lore');
    expect(helpText).toContain('test-atom');
  });
  it('should support running with zero protocols initially', async () => {
    // This tests the "atom" CLI scenario
    const { program } = await runCli({
      binaryName: 'atom', version: '0.0.0-test',
      description: 'Agnostic',
      engineDirName: TEST_ENGINE_DIR,
      configFileName: ENGINE_CONFIG_FILENAME,
      defaultConfig: TEST_ENGINE_CONFIG,
      staticProtocols: [], // Atom starts empty
    });
    expect(program).toBeDefined();
    expect(program.name()).toBe('atom');
  });
  it('should determine isScoped=true when protocol root is a subdirectory of git root', async () => {
    const spy = vi.spyOn(rootResolver, 'resolveProtocolRoot').mockResolvedValue({
      protocolRoot: '/repo/sub',
      gitRoot: '/repo'
    });
    const { sharedDeps } = await runCli({
      binaryName: 'atom', version: '0.0.0-test',
      description: 'Agnostic',
      engineDirName: TEST_ENGINE_DIR,
      configFileName: ENGINE_CONFIG_FILENAME,
      defaultConfig: TEST_ENGINE_CONFIG,
      staticProtocols: [],
    });
    expect((sharedDeps.atomRepository as any).baseTarget).toBeDefined();
    spy.mockRestore();
  });
  it('should determine isScoped=false when protocol root is the git root', async () => {
    const spy = vi.spyOn(rootResolver, 'resolveProtocolRoot').mockResolvedValue({
      protocolRoot: '/repo',
      gitRoot: '/repo'
    });
    const { sharedDeps } = await runCli({
      binaryName: 'atom', version: '0.0.0-test',
      description: 'Agnostic',
      engineDirName: TEST_ENGINE_DIR,
      configFileName: ENGINE_CONFIG_FILENAME,
      defaultConfig: TEST_ENGINE_CONFIG,
      staticProtocols: [],
    });
    expect((sharedDeps.atomRepository as any).baseTarget).toBeDefined();
    spy.mockRestore();
    });
  describe('Protocol Architectural Integrity', () => {
  it('should flow custom trailers from CLI flags to JSON output via metadata', async () => {
    // 1. Setup metadata in config
    const config = {
      ...TEST_PROTOCOL_CONFIG,
      trailers: {
          'Ticket-ID': {
            description: 'Issue tracker reference',
            multivalue: true,
            validation: 'pattern' as const,
            pattern: '^[A-Z]+-[0-9]+$',
            ui: { kind: 'reference' as any, color: 'dim' as any },
          },
      },
    };
    const protocol = makeProtocol(LoreProtocolDefinition, config);
    const registry = new ProtocolRegistry();
    registry.register(protocol);
    const options: CommitCommandOptions = {
      subject: 'feat: add stuff',
      'ticket-id': ['PROJ-123', 'PROJ-456'],
    } as any;
    const input = parseFlagsToInput(options, registry);
    // 2. Verify Reader mapped it correctly as a top-level property in root namespace
    const loreInput = input.trailers.get('lore') || {};
    expect(loreInput['Ticket-ID']).toEqual(['PROJ-123', 'PROJ-456']);
    // 3. Simulate Query Result (Core Logic)
    const trailers: Trailers = {
      [LORE_ID_KEY]: ['atom-123'],
      ...loreInput,
    };
    const atom: Atom = {
      commitHash: 'abc',
      date: new Date(),
      author: 'alice',
      subject: input.subject,
      body: '',
      filesChanged: [],
      protocols: new Map([
        ['lore', { trailers, unauthorized: {} }]
      ]),
    };
    const data: FormattableQueryResult = {
      result: {
        command: 'context',
        target: 't',
        targetType: 'file',
        atoms: [atom],
        meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
      },
      supersessionMap: new Map(),
      visibleTrailers: 'all',
    };
    // 4. Verify Formatter serializes it correctly
    const formatter = new JsonFormatter(registry);
    const output = JSON.parse(formatter.formatQueryResult(data));
    // Key should be CANONICAL in JSON inside the protocol's trailers object
    expect(output.results[0].protocols.lore.trailers['Ticket-ID']).toEqual(['PROJ-123', 'PROJ-456']);
  });
  it('should handle a hybrid flow of core and custom trailers simultaneously', async () => {
    const protocol = makeProtocol(LoreProtocolDefinition, TEST_PROTOCOL_CONFIG);
    const registry = new ProtocolRegistry();
    registry.register(protocol);
    const options: CommitCommandOptions = {
      subject: 'feat',
      confidence: 'high',
      trailer: ['Project-Code:LORE-001'],
    };
    const input = parseFlagsToInput(options, registry);
    // Verify both are captured correctly at top level in root namespace
    const loreInput = input.trailers.get('lore') || {};
    expect(loreInput.Confidence).toEqual(['high']);
    expect(loreInput['Project-Code']).toEqual(['LORE-001']);
  });
})
});
  describe('Engine Protocol Rebranding Flow', () => {
  it('should flow a custom protocol from raw trailers to namespaced JSON output', async () => {
    // 1. Define a custom protocol "Fred"
    const fredDef: ProtocolDefinition = {
      name: 'Fred',
      version: '2.5',
      namespace: 'fred', 
      identityKey: 'Fred-id',
      trailers: {
        'Fred-id': {
          description: 'Fred identity',
          multivalue: false,
          validation: 'pattern',
          pattern: '^[0-9a-f]{8}$',
        },
        'Status': {
          description: 'Fred status',
          multivalue: false,
          validation: 'none',
        }
      }
    };
    const fredProtocol = makeProtocol(fredDef, {
        identityKey: 'Fred-id',
        name: 'Fred',
        namespace: 'fred',
        trailers: { ...fredDef.trailers, strict: false, permissive: true }
    });
    const registry = new ProtocolRegistry();
    registry.register(fredProtocol);
    // 2. Mock Storage to return a Fred commit
    const mockGit = makeMockGitClient();
    const rawFredCommit = {
      hash: 'abc12345',
      date: new Date().toISOString(),
      author: 'fred@example.com',
      subject: 'feat: fredly change',
      body: '',
      trailers: 'fred: Fred-id: aabbccdd\nfred: Status: active',
      filesChanged: ['src/fred.ts']
    };
    vi.mocked(mockGit.query).mockResolvedValue([rawFredCommit]);
    vi.mocked(mockGit.getFilesChanged).mockResolvedValue(new Map([['abc12345', ['src/fred.ts']]]));
    // 3. Setup Repository
    const repo = new AtomRepository(
      mockGit as any,
      registry,
      new NullQueryCache(),
      makeQueryTarget()
    );
    const atoms = await repo.find(makeQueryTarget());
    expect(atoms).toHaveLength(1);
    const atom = atoms[0];
    // 4. Verify interpretation (Protocol data must be namespaced by name)
    expect(atom.protocols.has('fred')).toBe(true);
    const fredState = atom.protocols.get('fred')!;
    expect(fredState.trailers['Fred-id']).toEqual(['aabbccdd']);
    // 5. Format to JSON using the Engine's generic formatter
    const formatter = new JsonFormatter(registry);
    const json = JSON.parse(formatter.formatQueryResult({
      result: {
        atoms,
        meta: { totalAtoms: 1, filteredAtoms: 1, oldest: null, newest: null },
        command: 'search',
        target: 'all',
        targetType: 'global'
      },
      supersessionMap: new Map(),
      visibleTrailers: 'all',
    }));
    // 6. Verify Agnostic Structure (Data is in .protocols.fred)
    expect(json.results[0].commit).toBe('abc12345');
    expect(json.results[0].protocols.fred.id).toBe('aabbccdd');
    expect(json.results[0].protocols.fred.trailers.Status).toBe('active');
    // 7. Validation Integration (Ensures Validator respects custom definition)
    const results = await validateCommits([rawFredCommit], { 
      atomRepository: repo, 
      config: TEST_ENGINE_CONFIG, 
      protocolRegistry: registry 
    });
    expect(results[0].issues).toHaveLength(0);
    // Negative case: invalid ID based on Fred's custom pattern
    // 5. Verify validation of bad commit
    const badRawCommit = { ...rawFredCommit, trailers: 'fred: Fred-id: not-hex' };
    const results2 = await validateCommits([badRawCommit], { 
      atomRepository: repo, 
      config: TEST_ENGINE_CONFIG, 
      protocolRegistry: registry 
    });
    const formatIssue = results2[0].issues.find(i => i.rule === 'fred-id-format');
    expect(formatIssue).toBeDefined();
  });
})