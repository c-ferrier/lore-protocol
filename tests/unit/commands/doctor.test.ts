import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerDoctorCommand } from '../../../src/commands/doctor.js';
import { Protocol } from '../../../src/services/protocol.js';
import { LoreProtocolDefinition } from '../../../src/protocols/lore.js';
import { DEFAULT_CONFIG } from '../../../src/util/constants.js';
import type { Atom } from '../../../src/types/domain.js';

function createMockAtomRepository() {
  return {
    findAll: vi.fn(),
  };
}

function createMockConfigLoader() {
  return {
    resolveRoot: vi.fn().mockResolvedValue('/repo'),
    findConfigPath: vi.fn().mockResolvedValue('/repo/.lore/config.toml'),
  };
}

describe('Doctor Command', () => {
  let atomRepository: ReturnType<typeof createMockAtomRepository>;
  let configLoader: ReturnType<typeof createMockConfigLoader>;
  let protocol: Protocol;

  beforeEach(() => {
    atomRepository = createMockAtomRepository();
    configLoader = createMockConfigLoader();
    protocol = new Protocol(LoreProtocolDefinition, DEFAULT_CONFIG);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runDoctor(deps: any) {
    const program = new Command();
    program.exitOverride();
    registerDoctorCommand(program, deps);
    try {
      await program.parseAsync(['node', 'lore', 'doctor']);
    } catch (err) {
      if (err instanceof Error && err.message === 'process.exit') return;
      throw err;
    }
  }

  it('should report broken references for namespaced trailers', async () => {
    // 1. Create a namespaced protocol (Fred)
    const fred: any = {
      name: 'Fred',
      identityKey: 'Fred-id',
      namespace: 'Fred',
      isValidIdentity: (id: string) => /^[0-9a-f]{8}$/.test(id),
      getReferenceKeys: () => ['Depends-on'], // Canonical key, no prefix
      all: () => [],
    };

    // Use a custom registry-like behavior or just mock the atom data
    // The doctor command iterates over atom.trailers using protocol.getReferenceKeys()
    
    const atom: Atom = {
      id: '12345678', // Use valid hex for ID
      commitHash: 'h1',
      date: new Date(),
      author: 'cole@example.com',
      intent: 'intent',
      body: '',
      protocols: new Map([
        ['fred', { name: 'Fred', identityKey: 'Fred-id', trailers: { 'Depends-on': ['deadbeef'] } as any, version: '1.0' }]
      ]),
      filesChanged: []
    } as any;

    atomRepository.findAll.mockResolvedValue([atom]);

    // Capture console.log
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runDoctor({
      atomRepository,
      configLoader,
      gitClient: {},
      protocol: fred, // Act as Fred
    });

    const output = logSpy.mock.calls.map(args => args[0]).join('\n');
    expect(output).toContain('broken reference(s) found');
    expect(output).toContain('Fred-id "deadbeef" referenced by 12345678 (Depends-on) not found');
    
    logSpy.mockRestore();
  });

  it('should report duplicate identities for custom protocols', async () => {
    // 1. Setup Fred protocol
    const fred: any = {
      name: 'Fred',
      identityKey: 'Fred-id',
      namespace: '',
      isValidIdentity: (id: string) => true,
      getReferenceKeys: () => [],
    };

    // 2. Mock two atoms with the SAME Fred-id
    const atom1: any = {
      id: 'atom1',
      protocols: new Map([
        ['fred', { name: 'Fred', identityKey: 'Fred-id', trailers: { 'Fred-id': ['duplicate-123'] }, version: '1.0' }]
      ])
    };
    const atom2: any = {
      id: 'atom2',
      protocols: new Map([
        ['fred', { name: 'Fred', identityKey: 'Fred-id', trailers: { 'Fred-id': ['duplicate-123'] }, version: '1.0' }]
      ])
    };

    atomRepository.findAll.mockResolvedValue([atom1, atom2]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runDoctor({
      atomRepository,
      configLoader,
      gitClient: {},
      protocol: fred,
    });

    const output = logSpy.mock.calls.map(args => args[0]).join('\n');
    expect(output).toContain('duplicate Fred-id(s) found');
    expect(output).toContain('Fred-id "duplicate-123" appears 2 times');

    logSpy.mockRestore();
  });
});
