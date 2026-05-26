import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerDoctorCommand } from '../../../../src/engine/commands/doctor.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
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
    protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, {
        version: '1.0',
        trailers: { required: [], custom: [], definitions: {}, permissive: true }
    });
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runDoctor(deps: any) {
    const program = new Command();
    program.exitOverride();
    registerDoctorCommand(program, {
        cacheDir: '/tmp/atom-cache',
        protocolRegistry: new ProtocolRegistry(),
        defaultConfig: MOCK_CONFIG,
        ...deps
    });
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
      version: '1.0',
      isValidIdentity: (id: string) => /^[0-9a-f]{8}$/.test(id),
      getIdentity: (trailers: any) => trailers['Fred-id']?.[0] || null,
      getReferenceKeys: () => ['Depends-on'],
      getDefinition: (key: string) => ({ ui: { kind: key === 'Depends-on' ? 'reference' : 'text' } }),
      claims: () => false,
      owns: (key: string) => key.toLowerCase().startsWith('fred/'),
      authorize: (key: string) => key
    };
    
    const registry = new ProtocolRegistry();
    registry.register(fred);
    
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
      protocolRegistry: registry,
      getFormatter: () => ({
          formatDoctorResult: (data: any) => {
              if (data.status === 'unhealthy') {
                  const parts = ['unhealthy'];
                  for (const check of data.checks) {
                      if (check.status === 'error' || check.status === 'fail' || check.status === 'warning') {
                          parts.push(check.message);
                      }
                      if (check.details) parts.push(...check.details);
                  }
                  return parts.join('\n');
              }
              return 'ok';
          }
      })
    });

    const output = logSpy.mock.calls.map(args => args[0]).join('\n');
    expect(output).toContain('unhealthy');
    expect(output).toContain('broken reference(s) found');
    expect(output).toContain('Fred-id "deadbeef" referenced by h1 (Depends-on) not found');
    
    logSpy.mockRestore();
  });

  it('should report duplicate identities for custom protocols', async () => {
    // 1. Setup Fred protocol
    const fred: any = {
      name: 'Fred',
      identityKey: 'Fred-id',
      namespace: '',
      version: '1.0',
      isValidIdentity: (id: string) => true,
      getIdentity: (trailers: any) => trailers['Fred-id']?.[0] || null,
      getReferenceKeys: () => [],
      claims: () => false,
      owns: (key: string) => key === 'Fred-id',
      authorize: (key: string) => key
    };

    const registry = new ProtocolRegistry();
    registry.register(fred);

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
      protocolRegistry: registry,
      getFormatter: () => ({
          formatDoctorResult: (data: any) => {
              if (data.status === 'unhealthy') {
                  const parts = ['unhealthy'];
                  for (const check of data.checks) {
                      if (check.status === 'error' || check.status === 'fail' || check.status === 'warning') {
                          parts.push(check.message);
                      }
                      if (check.details) parts.push(...check.details);
                  }
                  return parts.join('\n');
              }
              return 'ok';
          }
      })
    });

    const output = logSpy.mock.calls.map(args => args[0]).join('\n');
    expect(output).toContain('unhealthy');
    expect(output).toContain('duplicate Fred-id(s) found');
    expect(output).toContain('Fred-id "duplicate-123" appears 2 times');

    logSpy.mockRestore();
  });
});
