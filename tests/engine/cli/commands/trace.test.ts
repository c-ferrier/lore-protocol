import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTraceCommand } from '../../../../src/engine/cli/commands/trace.js';
import { ProtocolMap } from '../../../../src/engine/core/models/protocol-map.js';
import * as Discovery from '../../../../src/engine/shell/orchestrators/discovery.js';
import { 
    makeAtom, 
    makeStubProtocolContext, 
    makeStubProtocolMap,
    makeStubProtocolState,
    type ProtocolContext, 
    TEST_ENGINE_CONFIG,
    TEST_ID_KEY, 
    TEST_PROTOCOL_DEFINITION} from '../../../../src/engine/testing.js';
import { type MockedGitClient, type MockedOutputFormatter } from '../../../mock-types.js';
import { 
    makeMockFormatter, 
    makeMockGitClient,
    makeMockInfra,
    TestLogger 
} from '../../engine-test-utils.js';

vi.mock('../../../../src/engine/shell/orchestrators/discovery.js', () => ({
    findAtomsByIds: vi.fn()
}));

describe('registerTraceCommand (Integrated Expansion)', () => {
  let git: MockedGitClient;
  let logger: TestLogger;
  let formatter: MockedOutputFormatter;
  let program: Command;
  let protocols: ProtocolMap<ProtocolContext>;

  beforeEach(() => {
    git = makeMockGitClient();
    // Register protocol with 'Related' reference trailer to enable tracing
    const protocol = makeStubProtocolContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: {
            ...TEST_PROTOCOL_DEFINITION.trailers,
            'Related': { description: 'R', multivalue: true, validation: 'reference', isCore: true }
        }
    });
    protocols = makeStubProtocolMap([protocol]);

    logger = new TestLogger();
    formatter = makeMockFormatter();
    formatter.formatTraceResult.mockReturnValue('formatted trace');
    program = new Command();
    program.exitOverride();

    registerTraceCommand(program, makeMockInfra({
      git,
      protocols,
      logger,
      config: TEST_ENGINE_CONFIG,
      getFormatter: () => formatter
    }), 'mock');
  });

  it('delegates BFS traversal to findAtomsByIds and builds edges', async () => {
    const id1 = 'aaaaaaaa';
    const id2 = 'bbbbbbbb';
const rootAtom = makeAtom({ 
    id: id1,
    protocols: makeStubProtocolMap([
        ['mock', makeStubProtocolState({ trailers: { [TEST_ID_KEY]: [id1], 'Related': [id2] } })]
    ])
});

const relatedAtom = makeAtom({
    id: id2,
    protocols: makeStubProtocolMap([
        ['mock', makeStubProtocolState({ trailers: { [TEST_ID_KEY]: [id2] } })]
    ])
});

    // Mock orchestrator to return the entire expanded set in one call
    vi.mocked(Discovery.findAtomsByIds).mockResolvedValue([rootAtom, relatedAtom]);

    await program.parseAsync(['node', 'test', 'trace', id1]);

    // 1. Verify orchestrator call: findAtomsByIds with follow: true
    expect(Discovery.findAtomsByIds).toHaveBeenCalledWith(
        expect.anything(),
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
    vi.mocked(Discovery.findAtomsByIds).mockResolvedValue([]);
    await expect(program.parseAsync(['node', 'test', 'trace', 'missing']))
        .rejects.toThrow(/not found in history/);
  });
});
