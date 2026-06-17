import { mkdirSync, rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach,describe, expect, it, vi } from 'vitest';

import { JsonFormatter } from '../src/cli/formatters/json-formatter.js';
import { hydrateAtoms } from '../src/core/logic/hydration.js';
import { type CommitCommandOptions,parseFlagsToInput } from '../src/core/logic/input-interpretation.js';
import { ProtocolMap } from '../src/core/models/protocol-map.js';
import { type Atom, type Trailers } from '../src/core/types/domain.js';
import { type ProtocolContext, type ProtocolDefinition } from '../src/core/types/protocol-definition.js';
import { runCli } from '../src/index-impl.js';
import * as rootResolver from '../src/shell/fs/root-resolver.js';
import { findAtoms } from '../src/shell/orchestrators/discovery.js';
import { validateCommits } from '../src/shell/orchestrators/validation.js';
import { makeQueryTarget, makeStubEngineConfig, makeStubProtocolContext, makeStubProtocolMap, makeStubProtocolState, TEST_ENGINE_CONFIG, TEST_ID_KEY,TEST_PROTOCOL_DEFINITION } from '../src/testing.js';
import { ENGINE_CONFIG_FILENAME } from '../src/util/constants.js';
import { makeMockGitClient, makeMockInfra,makeMockPrompt } from './engine-test-utils.js';

describe('Engine Assembly (Agnostic Bootstrap)', () => {
  const testDir = join(tmpdir(), `engine-bootstrap-${Date.now()}`);
  const pkgPath = join(testDir, 'package.json');
  const CUSTOM_PROTOCOL = {
    name: 'Custom',
    version: '1.0',
    identityKey: 'Custom-id',
    namespace: 'custom',
    strict: true,
    permissive: false,
    trailers: {}
  };
  const MOCK_BOOTSTRAP_CONFIG = makeStubEngineConfig({
    cli: { updateCheck: false },
  });
  beforeAll(() => {
    mkdirSync(join(testDir, 'engine-test-dir'), { recursive: true });
    mkdirSync(testDir, { recursive: true });
    writeFileSync(pkgPath, JSON.stringify({ version: '1.0.0' }));
  });
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });
  it('should bootstrap the engine with a custom protocol and no Lore mentions', async () => {
    const { program, infra } = await runCli({
      prompt: makeMockPrompt(),
      binaryName: 'test-atom',
      version: '0.0.0-test',
      description: 'Test Engine',
      engineDirName: 'engine-test-dir',
      configFileName: ENGINE_CONFIG_FILENAME,
      defaultConfig: MOCK_BOOTSTRAP_CONFIG,
      staticProtocols: [CUSTOM_PROTOCOL],
    },);
    expect(program.name()).toBe('test-atom');
    const customProtocol = infra.protocols.get('custom');
    expect(customProtocol).toBeDefined();
    expect(customProtocol?.name).toBe('custom');
    expect(customProtocol?.storageNamespace).toBe('custom');
    // Verify infra are wired correctly
    expect(infra.git).toBeDefined();
    expect(infra.cache).toBeDefined();
    // Check for "Lore" leakage in help text
    const helpText = program.helpInformation();
    expect(helpText).not.toContain('Lore');
    expect(helpText).toContain('test-atom');
  });
  it('should support running with zero protocols initially', async () => {
    // This tests the "atom" CLI scenario
    const { program } = await runCli({
      prompt: makeMockPrompt(),
      binaryName: 'atom', version: '0.0.0-test',
      description: 'Agnostic',
      engineDirName: 'engine-test-dir',
      configFileName: ENGINE_CONFIG_FILENAME,
      defaultConfig: MOCK_BOOTSTRAP_CONFIG,
      staticProtocols: [], // Atom starts empty
    },);
    expect(program).toBeDefined();
    expect(program.name()).toBe('atom');
  });
  it('should determine isScoped=true when protocol root is a subdirectory of git root', async () => {
    const spy = vi.spyOn(rootResolver, 'resolveProtocolRoot').mockResolvedValue({
      protocolRoot: '/repo/sub',
      isScoped: true
    });
    const { infra } = await runCli({
      prompt: makeMockPrompt(),
      binaryName: 'atom', version: '0.0.0-test',
      description: 'Agnostic',
      engineDirName: 'engine-test-dir',
      configFileName: ENGINE_CONFIG_FILENAME,
      defaultConfig: MOCK_BOOTSTRAP_CONFIG,
      staticProtocols: [],
    },);
    // VERIFICATION: baseTarget must be scoped to current directory ['.']
    expect(infra.baseTarget.resolvedPaths).toEqual(['.']);
    spy.mockRestore();
  });
  it('should determine isScoped=false when protocol root is the git root', async () => {
    const spy = vi.spyOn(rootResolver, 'resolveProtocolRoot').mockResolvedValue({
      protocolRoot: '/repo',
      isScoped: false
    });
    const { infra } = await runCli({
      prompt: makeMockPrompt(),
      binaryName: 'atom', version: '0.0.0-test',
      description: 'Agnostic',
      engineDirName: 'engine-test-dir',
      configFileName: ENGINE_CONFIG_FILENAME,
      defaultConfig: MOCK_BOOTSTRAP_CONFIG,
      staticProtocols: [],
    },);
    // VERIFICATION: baseTarget must be global (empty resolvedPaths)
    expect(infra.baseTarget.resolvedPaths).toEqual([]);
    spy.mockRestore();
  });

  describe('Protocol Architectural Integrity', () => {
  let protocols: ProtocolMap<ProtocolContext>;

  beforeEach(() => {
    protocols = makeStubProtocolMap();
  });

  it('should flow custom trailers from CLI flags to JSON output via metadata', async () => {
    // 1. Setup metadata in config
    const configOverrides: Partial<ProtocolDefinition> = {
      trailers: {
          'Ticket-ID': {
            description: 'Issue tracker reference',
            multivalue: true,
            validation: 'pattern' as const,
            pattern: '^[A-Z]+-[0-9]+$',
            ui: { kind: 'reference', color: 'dim' },
          },
      },
    };
    
    // Create protocol context with the overrides from "config"
    const protocol = makeStubProtocolContext(TEST_PROTOCOL_DEFINITION, configOverrides);
    protocols.set(protocol.name, protocol);

    const options: CommitCommandOptions = {
      subject: 'feat: add stuff',
      trailer: ['Ticket-ID=PROJ-123', 'Ticket-ID=PROJ-456'],
    };
    const input = parseFlagsToInput(options, protocols);

    // 2. Verify Reader mapped it correctly using the merged metadata
    const mockInput = input.trailers?.get('mock') || {};
    expect(mockInput['Ticket-ID']).toEqual(['PROJ-123', 'PROJ-456']);

    // 3. Simulate Query Result (Core Logic)
    const trailers: Trailers = {
      [TEST_ID_KEY]: ['atom-123'],
      ...mockInput,
    };
    const atom: Atom = {
      commitHash: 'abc',
      date: new Date(),
      author: 'alice',
      subject: input.subject || '',
      body: '',
      rawTrailers: '',
      filesChanged: [],
      protocols: makeStubProtocolMap([
        ['mock', makeStubProtocolState({ trailers })]
      ]),
    };
    // 4. Verify Formatter serializes it correctly
    const formatter = new JsonFormatter(protocols);
    const output = JSON.parse(formatter.formatQueryAtom({ atom, visibleTrailers: 'all' }));
    // Key should be CANONICAL in JSON inside the protocol's trailers object
    expect(output.data.protocols.mock.trailers['Ticket-ID']).toEqual(['PROJ-123', 'PROJ-456']);
  });

  it('should handle a hybrid flow of core and custom trailers simultaneously', async () => {
    const protocol = makeStubProtocolContext({
        ...TEST_PROTOCOL_DEFINITION,
        permissive: true,
        strict: false
    });

    protocols.set(protocol.name, protocol);
    const options: CommitCommandOptions = {
      subject: 'feat',
      trailer: [`${TEST_ID_KEY}=abc12345`, 'Project-Code=LORE-001'],
    };
    const input = parseFlagsToInput(options, protocols);
    // Verify both are captured correctly
    const mockInput = input.trailers?.get('mock') || {};
    expect(mockInput[TEST_ID_KEY]).toEqual(['abc12345']);
    expect(mockInput['Project-Code']).toEqual(['LORE-001']);
  });
});

  describe('Engine Protocol Rebranding Flow', () => {
  it('should flow a custom protocol from raw trailers to namespaced JSON output', async () => {
    // 1. Define a custom protocol "Fred"
    const fredDef: ProtocolDefinition = {
      name: 'Fred',
      version: '2.5',
      namespace: 'fred', 
      identityKey: 'Fred-id',
      strict: true,
      permissive: false,
      trailers: {
        'Fred-id': {
          description: 'Fred identity',
          multivalue: false,
          validation: 'pattern' as const,
          pattern: '^[0-9a-f]{8}$',
        },
        'Status': {
          description: 'Fred status',
          multivalue: false,
          validation: 'none' as const,
        }
      }
    };
    const fredProtocol = makeStubProtocolContext(fredDef);
    const protocols = makeStubProtocolMap([fredProtocol]);

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
    mockGit.queryStream.mockImplementation(async function* () { yield* [rawFredCommit]; });
    mockGit.getFilesChanged.mockResolvedValue(new Map([['abc12345', ['src/fred.ts']]]));
    
    // 3. Setup Infra
    const infra = makeMockInfra({
      git: mockGit,
      protocols,
    });

    const atoms = await findAtoms(infra, makeQueryTarget());
    expect(atoms).toHaveLength(1);
    const atom = atoms[0];
    // 4. Verify interpretation (Protocol data must be namespaced by name)
    expect(atom.protocols.has('fred')).toBe(true);
    const fredState = atom.protocols.get('fred')!;
    expect(fredState.trailers['Fred-id']).toEqual(['aabbccdd']);
    // 5. Format to JSON using the Engine's generic formatter
    const formatter = new JsonFormatter(protocols);
    const json = JSON.parse(formatter.formatQueryAtom({ atom, visibleTrailers: 'all' }));
    // 6. Verify Agnostic Structure (Data is in .data.protocols.fred)
    expect(json.data.commit).toBe('abc12345');
    expect(json.data.protocols.fred.id).toBe('aabbccdd');
    expect(json.data.protocols.fred.trailers.Status).toBe('active');
    // 7. Validation Integration (Ensures Validator respects custom definition)
    const results = await validateCommits(hydrateAtoms([rawFredCommit], protocols, { includeAllCommits: true }), { 
      ...infra,
      config: TEST_ENGINE_CONFIG, 
    });
    expect(results[0].issues).toHaveLength(0);
    // Negative case: invalid ID based on Fred's custom pattern
    // 5. Verify validation of bad commit
    const badRawCommit = { ...rawFredCommit, trailers: 'fred: Fred-id: not-hex' };
    const results2 = await validateCommits(hydrateAtoms([badRawCommit], protocols, { includeAllCommits: true }), { 
      ...infra,
      config: TEST_ENGINE_CONFIG, 
    });
    const formatIssue = results2[0].issues.find(i => i.rule === 'fred-id-format');
    expect(formatIssue).toBeDefined();
  });
});
});