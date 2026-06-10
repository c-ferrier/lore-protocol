import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDoctorCommand } from '../../../../src/engine/cli/commands/doctor.js';
import { ProtocolMap } from '../../../../src/engine/core/models/protocol-map.js';
import { type ProtocolContext } from '../../../../src/engine/core/types/protocol-definition.js';
import type { EngineInfra } from '../../../../src/engine/services/engine-bootstrapper.js';
import * as Discovery from '../../../../src/engine/shell/orchestrators/discovery.js';
import { makeAtom, makeStubProtocolContext, TEST_PROTOCOL_DEFINITION } from '../../../../src/engine/testing.js';
import { makeMockFormatter, makeMockGitClient, makeMockInfra, TestLogger } from '../../engine-test-utils.js';

vi.mock('../../../../src/engine/shell/orchestrators/discovery.js', () => ({
    findAtoms: vi.fn()
}));

describe('Doctor Command', () => {
  let protocol: ProtocolContext;

  beforeEach(() => {
    protocol = makeStubProtocolContext(TEST_PROTOCOL_DEFINITION);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
    vi.mocked(Discovery.findAtoms).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runDoctor(overrides: Partial<EngineInfra> = {}) {
    const program = new Command();
    program.exitOverride();
    
    const infra = makeMockInfra(overrides);
    registerDoctorCommand(program, infra);
    
    try {
      await program.parseAsync(['node', 'atom', 'doctor']);
    } catch (err) {
      if (err instanceof Error && err.message === 'process.exit') return;
      throw err;
    }
  }

  it('should run basic health checks', async () => {
    const logger = new TestLogger();
    const protocols = new ProtocolMap<ProtocolContext>();
    protocols.set(protocol.name, protocol);

    await runDoctor({
      logger,
      protocols
    });

    expect(logger.resultLogs[0]).toContain('Mock Doctor Result');
  });

  it('should report git connectivity status', async () => {
    const git = makeMockGitClient();
    git.resolveRef.mockResolvedValue('hash123');
    const logger = new TestLogger();

    await runDoctor({
      git,
      logger
    });

    expect(git.resolveRef).toHaveBeenCalledWith('HEAD');
  });

  it('should handle git errors gracefully', async () => {
    const git = makeMockGitClient();
    git.resolveRef.mockRejectedValue(new Error('Git is broken'));
    const logger = new TestLogger();
    const formatter = makeMockFormatter();

    await runDoctor({
      git,
      logger,
      getFormatter: () => formatter
    });

    // Verify it still produces a result even if git fails
    expect(formatter.formatDoctorResult).toHaveBeenCalled();
  });

  it('should report broken references for namespaced trailers', async () => {
    const atom = makeAtom({
      commitHash: 'h1',
      protocols: new Map([
        ['mock', { 
            trailers: { 'Ref-id': ['missing'] },
            unauthorized: {}
        }]
      ]),
      filesChanged: []
    });

    vi.mocked(Discovery.findAtoms).mockResolvedValue([atom]);
    const logger = new TestLogger();
    const protocols = new ProtocolMap<ProtocolContext>();
    const protocolWithRef = makeStubProtocolContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: {
            ...TEST_PROTOCOL_DEFINITION.trailers,
            'Ref-id': { description: 'R', multivalue: true, validation: 'reference' as const }
        }
    });
    protocols.set(protocolWithRef.name, protocolWithRef);

    const formatter = makeMockFormatter();

    await runDoctor({
      logger,
      protocols,
      getFormatter: () => formatter
    });

    expect(Discovery.findAtoms).toHaveBeenCalled();
    expect(formatter.formatDoctorResult).toHaveBeenCalled();
  });

  it('should identify duplicate IDs across the repository', async () => {
    const atom1 = makeAtom({
      commitHash: 'h1',
      protocols: new Map([['mock', { trailers: { 'Mock-id': ['id1'] }, unauthorized: {} }]]),
      filesChanged: []
    });
    const atom2 = makeAtom({
      commitHash: 'h2',
      protocols: new Map([['mock', { trailers: { 'Mock-id': ['id1'] }, unauthorized: {} }]]),
      filesChanged: []
    });

    vi.mocked(Discovery.findAtoms).mockResolvedValue([atom1, atom2]);
    const logger = new TestLogger();
    const protocols = new ProtocolMap<ProtocolContext>();
    protocols.set(protocol.name, protocol);

    const formatter = makeMockFormatter();

    await runDoctor({
      logger,
      protocols,
      getFormatter: () => formatter
    });

    expect(Discovery.findAtoms).toHaveBeenCalled();
    expect(formatter.formatDoctorResult).toHaveBeenCalledWith(expect.objectContaining({
        status: 'unhealthy',
        summary: expect.objectContaining({ errors: 1 })
    }));
  });
});