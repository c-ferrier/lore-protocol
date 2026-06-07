import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTraceCommand } from '../../../../src/engine/cli/commands/trace.js';
import { type IOutputFormatter } from '../../../../src/engine/interfaces/output-formatter.js';
import { 
    makeAtom, 
    makeStubProtocolContext, 
    makeStubProtocolRegistry,
    TEST_ENGINE_CONFIG,
    TEST_ID_KEY, 
    TEST_PROTOCOL_DEFINITION 
} from '../../../../src/engine/testing.js';
import { 
    makeMockAtomRepository, 
    makeMockGitClient,
    TestLogger 
} from '../../engine-test-utils.js';

describe('registerTraceCommand (Integrated Expansion)', () => {
  let atomRepository: any;
  let protocolRegistry: any;
  let gitClient: any;
  let logger: TestLogger;
  let formatter: any;
  let program: Command;

  beforeEach(() => {
    atomRepository = makeMockAtomRepository();
    gitClient = makeMockGitClient();
    // Register protocol with 'Related' reference trailer to enable tracing
    protocolRegistry = makeStubProtocolRegistry([makeStubProtocolContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: {
            ...TEST_PROTOCOL_DEFINITION.trailers,
            'Related': { description: 'R', multivalue: true, validation: 'reference', isCore: true } as any
        }
    })]);
    logger = new TestLogger();
    formatter = {
        formatTraceResult: vi.fn(() => 'formatted trace'),
    };
    program = new Command();
    program.exitOverride();

    registerTraceCommand(program, {
      atomRepository,
      gitClient,
      protocolRegistry,
      logger,
      config: TEST_ENGINE_CONFIG,
      getFormatter: () => formatter as unknown as IOutputFormatter
    });
  });

  it('delegates BFS traversal to the repository and builds edges', async () => {
    const id1 = 'aaaaaaaa';
    const id2 = 'bbbbbbbb';

    const rootAtom = makeAtom({ 
        id: id1,
        protocols: new Map([['mock', { 
            trailers: { [TEST_ID_KEY]: [id1], 'Related': [id2] },
            unauthorized: {} 
        }]])
    });

    const relatedAtom = makeAtom({
        id: id2,
        protocols: new Map([['mock', { 
            trailers: { [TEST_ID_KEY]: [id2] },
            unauthorized: {} 
        }]])
    });

    // Mock repository to return the entire expanded set in one call
    atomRepository.findByIds.mockResolvedValue([rootAtom, relatedAtom]);

    await program.parseAsync(['node', 'test', 'trace', id1]);

    // 1. Verify repository call: findByIds with follow: true
    expect(atomRepository.findByIds).toHaveBeenCalledWith(
        [expect.objectContaining({ id: id1 })],
        expect.objectContaining({ follow: true, maxDepth: 10 })
    );

    // 2. Verify edge generation
    expect(formatter.formatTraceResult).toHaveBeenCalledWith(expect.objectContaining({
        root: rootAtom,
        edges: [
            expect.objectContaining({
                from: id1,
                to: id2,
                relationship: 'Related',
                targetAtom: relatedAtom
            })
        ]
    }));
  });

  it('throws error if root atom is not found', async () => {
    atomRepository.findByIds.mockResolvedValue([]);
    await expect(program.parseAsync(['node', 'test', 'trace', 'missing']))
        .rejects.toThrow(/not found in history/);
  });
});
