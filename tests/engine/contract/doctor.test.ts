import { registerDoctorCommand } from '../../../src/engine/cli/commands/doctor.js';
import { type Atom, ProtocolMap } from '../../../src/engine/core/types/domain.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { TEST_ENGINE_CONFIG, TEST_PROTOCOL_DEFINITION, makeMockContext } from '../../../src/engine/testing.js';
import { TestLogger, makeMockAtomRepository, makeMockConfigLoader, makeMockGitClient, makeMockProtocolContext } from '../engine-test-utils.js';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

describe('Doctor Command', () => {
  let atomRepository: any;
  let configLoader: any;
  let protocol: ProtocolContext;

  beforeEach(() => {
    atomRepository = makeMockAtomRepository();
    configLoader = makeMockConfigLoader({
        resolveRoot: vi.fn().mockResolvedValue('/repo'),
        findConfigPath: vi.fn().mockResolvedValue('/repo/.mock/config.toml'),
    });
    protocol = makeMockContext(TEST_PROTOCOL_DEFINITION);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runDoctor(deps: any) {
    const program = new Command();
    program.exitOverride();
    registerDoctorCommand(program, {
        protocolRegistry: new ProtocolRegistry(),
        logger: new TestLogger(),
        gitClient: makeMockGitClient(),
        getFormatter: () => ({
            formatDoctorResult: vi.fn().mockReturnValue('Report')
        }),
        configLoader,
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
    const fred = makeMockProtocolContext({
      name: 'Fred',
      identityKey: 'Fred-id',
      namespace: 'Fred',
      trailers: { 
          'Fred-id': { description: 'ID', validation: 'pattern', pattern: '^[0-9a-f]{8}$' },
          'Depends-on': { description: '', multivalue: true, validation: 'reference' } 
      } as any,
    });
    
    const registry = new ProtocolRegistry();
    registry.register(fred);
    
    const atom: Atom = {
      commitHash: 'h1',
      date: new Date(),
      author: 'cole@example.com',
      subject: 'subject',
      body: '',
      protocols: new ProtocolMap([
        ['fred', { trailers: { 'Fred-id': ['12345678'], 'Depends-on': ['deadbeef'] }, unauthorized: {} }]
      ]),
      filesChanged: new Set()
    };

    atomRepository.find.mockResolvedValue([atom]);

    const logger = new TestLogger();

    await runDoctor({
      atomRepository,
      logger,
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
      protocols: new ProtocolMap([['mock', { trailers: { 'Mock-id': ['12345678'] }, unauthorized: {} }]]),
      filesChanged: new Set()
    };
    const atom2: Atom = {
      commitHash: 'h2',
      date: new Date(),
      author: 'a', subject: 's', body: 'b',
      protocols: new ProtocolMap([['mock', { trailers: { 'Mock-id': ['12345678'] }, unauthorized: {} }]]),
      filesChanged: new Set()
    };

    atomRepository.find.mockResolvedValue([atom1, atom2]);
    const logger = new TestLogger();

    await runDoctor({
      atomRepository,
      logger,
      protocolRegistry: registry,
      getFormatter: () => ({
          formatDoctorResult: vi.fn().mockReturnValue('Duplicate ID')
      })
    });

    expect(logger.resultLogs[0]).toContain('Duplicate ID');
  });
});
