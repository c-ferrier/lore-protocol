import { registerTraceCommand } from '../../../../src/engine/cli/commands/trace.js';
import { type IOutputFormatter } from '../../../../src/engine/interfaces/output-formatter.js';
import { TEST_ID_KEY, TEST_PROTOCOL_DEFINITION, makeAtom, makeProtocol, makeProtocolRegistry } from '../../../../src/engine/testing.js';
import { TestLogger, makeMockAtomRepository, makeMockGitClient } from '../../engine-test-utils.js';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
;
;


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
    protocolRegistry = makeProtocolRegistry([makeProtocol({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: {
            ...TEST_PROTOCOL_DEFINITION.trailers,
            'Related': { description: 'R', validation: 'reference' } as any
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