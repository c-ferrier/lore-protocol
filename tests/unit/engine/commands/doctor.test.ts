import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerDoctorCommand } from '../../../../src/engine/commands/doctor.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { 
    MOCK_PROTOCOL_DEFINITION, 
    MOCK_CONFIG, 
    MockLogger, 
    makeMockAtomRepository, 
    makeMockGitClient 
} from '../test-utils.js';
import type { Atom } from '../../../../src/engine/types/domain.js';

function createMockConfigLoader() {
  return {
    resolveRoot: vi.fn().mockResolvedValue('/repo'),
    findConfigPath: vi.fn().mockResolvedValue('/repo/.mock/config.toml'),
  };
}

describe('Doctor Command', () => {
  let atomRepository: any;
  let configLoader: ReturnType<typeof createMockConfigLoader>;
  let protocol: Protocol;

  beforeEach(() => {
    atomRepository = makeMockAtomRepository();
    configLoader = createMockConfigLoader();
    protocol = new Protocol(MOCK_PROTOCOL_DEFINITION);
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
        logger: new MockLogger(),
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
      getIdentity: (state: any) => state?.trailers['Fred-id']?.[0] || null,
      getReferenceKeys: () => ['Depends-on'],
      getDefinition: (key: string) => ({ ui: { kind: key === 'Depends-on' ? 'reference' : 'text' } }),
      claims: () => false,
      owns: (key: string) => key.toLowerCase().startsWith('fred/'),
      authorize: (key: string) => key,
      setRegistry: vi.fn()
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
        ['fred', { trailers: { 'Fred-id': ['12345678'], 'Depends-on': ['deadbeef'] }, unauthorized: {} }]
      ]),
      filesChanged: []
    } as any;

    atomRepository.find.mockResolvedValue([atom]);

    const logger = new MockLogger();

    await runDoctor({
      atomRepository,
      configLoader,
      logger,
      gitClient: makeMockGitClient(),
      protocolRegistry: registry,
      getFormatter: () => ({
          formatDoctorResult: vi.fn().mockReturnValue('Report')
      })
    });

    expect(logger.resultLogs[0]).toContain('Report');
  });

  it('should report duplicate identities for custom protocols', async () => {
    const registry = new ProtocolRegistry();
    registry.register(protocol);

    const atom1: Atom = {
      commitHash: 'h1',
      date: new Date(),
      author: 'a', subject: 's', body: 'b',
      protocols: new Map([['mock', { trailers: { 'Mock-id': ['12345678'] }, unauthorized: {} }]]),
      filesChanged: []
    } as any;
    const atom2: Atom = {
      commitHash: 'h2',
      date: new Date(),
      author: 'a', subject: 's', body: 'b',
      protocols: new Map([['mock', { trailers: { 'Mock-id': ['12345678'] }, unauthorized: {} }]]),
      filesChanged: []
    } as any;

    atomRepository.find.mockResolvedValue([atom1, atom2]);
    const logger = new MockLogger();

    await runDoctor({
      atomRepository,
      configLoader,
      logger,
      gitClient: makeMockGitClient(),
      protocolRegistry: registry,
      getFormatter: () => ({
          formatDoctorResult: vi.fn().mockReturnValue('Duplicate ID')
      })
    });

    expect(logger.resultLogs[0]).toContain('Duplicate ID');
  });
});
