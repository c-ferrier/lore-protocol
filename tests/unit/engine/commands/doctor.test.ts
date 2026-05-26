import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerDoctorCommand } from '../../../../src/engine/commands/doctor.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG } from '../test-utils.js';
import type { Atom } from '../../../../src/engine/types/domain.js';

function createMockAtomRepository() {
  return {
    findAll: vi.fn(),
    findById: vi.fn(),
  };
}

function createMockConfigLoader() {
  return {
    resolveRoot: vi.fn().mockResolvedValue('/repo'),
    findConfigPath: vi.fn().mockResolvedValue('/repo/.mock/config.toml'),
  };
}

describe('Doctor Command', () => {
  let atomRepository: ReturnType<typeof createMockAtomRepository>;
  let configLoader: ReturnType<typeof createMockConfigLoader>;
  let protocol: Protocol;

  beforeEach(() => {
    atomRepository = createMockAtomRepository();
    configLoader = createMockConfigLoader();
    protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG);
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
      await program.parseAsync(['node', 'atom', 'doctor']);
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
      getIdentity: (trailers: any) => trailers['Fred-id']?.[0] || null,
      getReferenceKeys: () => ['Depends-on'], // Canonical key, no prefix
      all: () => [],
    };
    
    const atom: Atom = {
      commitHash: 'h1',
      date: new Date(),
      author: 'cole@example.com',
      subject: 'subject',
      body: '',
      protocols: new Map([
        ['fred', { name: 'Fred', identityKey: 'Fred-id', trailers: { 'Fred-id': ['12345678'], 'Depends-on': ['deadbeef'] } as any, version: '1.0' }]
      ]),
      filesChanged: []
    } as any;

    atomRepository.findAll.mockResolvedValue([atom]);

    // Capture console.log
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runDoctor({
      atomRepository,
      configLoader,
      gitClient: {
        isInsideRepo: vi.fn().mockResolvedValue(true),
        getRepoRoot: vi.fn().mockResolvedValue('/repo'),
      },
      protocol: fred, // Act as Fred
      getFormatter: () => ({
          formatDoctorResult: vi.fn((data) => {
              if (data.checks.some(c => c.status === 'warning' && c.name === 'Orphaned dependencies')) {
                  return 'broken reference(s) found\nFred-id "deadbeef" referenced by 12345678 (Depends-on) not found';
              }
              return 'ok';
          })
      })
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
      getIdentity: (trailers: any) => trailers['Fred-id']?.[0] || null,
      getReferenceKeys: () => [],
    };

    // 2. Mock two atoms with the SAME Fred-id
    const atom1: any = {
      protocols: new Map([
        ['fred', { name: 'Fred', identityKey: 'Fred-id', trailers: { 'Fred-id': ['duplicate-123'] }, version: '1.0' }]
      ])
    };
    const atom2: any = {
      protocols: new Map([
        ['fred', { name: 'Fred', identityKey: 'Fred-id', trailers: { 'Fred-id': ['duplicate-123'] }, version: '1.0' }]
      ])
    };

    atomRepository.findAll.mockResolvedValue([atom1, atom2]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runDoctor({
      atomRepository,
      configLoader,
      gitClient: {
        isInsideRepo: vi.fn().mockResolvedValue(true),
        getRepoRoot: vi.fn().mockResolvedValue('/repo'),
      },
      protocol: fred,
      getFormatter: () => ({
          formatDoctorResult: vi.fn((data) => {
               if (data.checks.some(c => c.name === 'Identity uniqueness' && c.status === 'error')) {
                   return 'duplicate Fred-id(s) found\nFred-id "duplicate-123" appears 2 times';
               }
               return 'ok';
          })
      })
    });

    const output = logSpy.mock.calls.map(args => args[0]).join('\n');
    expect(output).toContain('duplicate Fred-id(s) found');
    expect(output).toContain('Fred-id "duplicate-123" appears 2 times');

    logSpy.mockRestore();
  });
});
