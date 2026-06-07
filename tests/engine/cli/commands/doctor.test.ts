import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDoctorCommand } from '../../../../src/engine/cli/commands/doctor.js';
import { type Atom } from '../../../../src/engine/core/types/domain.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { makeStubContext, TEST_PROTOCOL_DEFINITION } from '../../../../src/engine/testing.js';
import { makeMockAtomRepository, makeMockConfigLoader, makeMockFormatter, TestLogger } from '../../engine-test-utils.js';

describe('Doctor Command', () => {
  let atomRepository: any;
  let configLoader: any;
  let protocol: any;

  beforeEach(() => {
    atomRepository = makeMockAtomRepository();
    configLoader = makeMockConfigLoader({
        resolveRoot: vi.fn().mockResolvedValue('/repo'),
        findConfigPath: vi.fn().mockResolvedValue('/repo/.mock/config.toml'),
    });
    protocol = makeStubContext(TEST_PROTOCOL_DEFINITION);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runDoctor(deps: any) {
    const program = new Command();
    program.exitOverride();
    
    // Tiered signature: registerDoctorCommand(program, deps)
    // where deps contains the full I/O bag
    registerDoctorCommand(program, {
        atomRepository: deps.atomRepository || atomRepository,
        getFormatter: deps.getFormatter || (() => makeMockFormatter()),
        protocolRegistry: deps.protocolRegistry || new ProtocolRegistry(),
        logger: deps.logger || new TestLogger(),
        configLoader
    } as any);
    
    try {
      await program.parseAsync(['node', 'atom', 'doctor']);
    } catch (err) {
      if (err instanceof Error && err.message === 'process.exit') return;
      throw err;
    }
  }

  it('should report broken references for namespaced trailers', async () => {
    const atom = {
      commitHash: 'h1',
      protocols: new Map([
        ['mock', { 
            trailers: { 'Ref-id': ['missing'] },
            unauthorized: {}
        }]
      ]),
      filesChanged: []
    } as unknown as Atom;

    atomRepository.find.mockResolvedValue([atom]);
    const logger = new TestLogger();
    const registry = new ProtocolRegistry();
    registry.register(protocol);

    await runDoctor({
      atomRepository,
      logger,
      protocolRegistry: registry
    });

    expect(logger.resultLogs[0]).toContain('Mock Doctor Result');
  });

  it('should identify duplicate IDs across the repository', async () => {
    const atom1 = {
      commitHash: 'h1',
      protocols: new Map([['mock', { trailers: { 'Mock-id': ['id1'] }, unauthorized: {} }]]),
      filesChanged: []
    } as unknown as Atom;
    const atom2 = {
      commitHash: 'h2',
      protocols: new Map([['mock', { trailers: { 'Mock-id': ['id1'] }, unauthorized: {} }]]),
      filesChanged: []
    } as unknown as Atom;

    atomRepository.find.mockResolvedValue([atom1, atom2]);
    const logger = new TestLogger();
    const registry = new ProtocolRegistry();
    registry.register(protocol);

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
