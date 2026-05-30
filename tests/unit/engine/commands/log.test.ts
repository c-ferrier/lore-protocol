import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerLogCommand } from '../../../../src/engine/commands/log.js';
import type { AtomRepository } from '../../../../src/engine/services/atom-repository.js';
import type { SupersessionResolver } from '../../../../src/engine/services/supersession-resolver.js';
import type { IOutputFormatter } from '../../../../src/engine/interfaces/output-formatter.js';
import type { Atom } from '../../../../src/engine/types/domain.js';
import { 
    MOCK_ID_KEY, 
    MockLogger, 
    makeAtom, 
    makeMockAtomRepository, 
    makeMockSupersessionResolver 
} from '../test-utils.js';
import type { ILogger } from '../../../../src/engine/interfaces/logger.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { makeProtocol } from '../test-utils.js';
import { MOCK_PROTOCOL_DEFINITION } from '../test-utils.js';

/**
 * Regression tests for positional path arguments in log command.
 */

interface Harness {
  program: Command;
  capturedResult: { data: unknown };
  repo: any;
  logger: MockLogger;
}

function buildHarness(atoms: Atom[], filteredAtoms?: Atom[]): Harness {
  const repo = makeMockAtomRepository({
      find: vi.fn().mockResolvedValue(filteredAtoms ?? atoms),
  });

  const supersessionResolver = makeMockSupersessionResolver({
      resolveAll: vi.fn().mockReturnValue(new Map([['mock', new Map()]])),
  });

  const capturedResult: { data: unknown } = { data: undefined };
  const formatter = {
    formatQueryResult: vi.fn((data: unknown) => {
        capturedResult.data = data;
        return '';
    }),
  } as unknown as IOutputFormatter;

  const logger = new MockLogger();
  const program = new Command();
  program.exitOverride();

  const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
  const protocolRegistry = new ProtocolRegistry();
  protocolRegistry.register(protocol);

  registerLogCommand(program, {
    atomRepository: repo,
    supersessionResolver,
    getFormatter: () => formatter,
    logger,
  });

  return { program, capturedResult, repo, logger };
}

describe('registerLogCommand (agnostic path arguments)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a positional path and routes through find()', async () => {
    const matching = makeAtom({ 
        protocols: new Map([['mock', { trailers: { [MOCK_ID_KEY]: ['match0002'] }, unauthorized: {} }]]),
        filesChanged: ['src/main.ts'],
        subject: 'feat(main): change' 
    });
    const h = buildHarness([matching], [matching]);

    await h.program.parseAsync(['node', 'atom', 'log', 'src/main.ts']);

    expect(h.repo.find).toHaveBeenCalledTimes(1);
    expect(h.repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ target: ['src/main.ts'] })
    );

    const result = (h.capturedResult.data as { result: { atoms: any[] } }).result;
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].protocols.get('mock').trailers[MOCK_ID_KEY][0]).toBe('match0002');
  });

  it('accepts the `--` pass-through and routes identically', async () => {
    const matching = makeAtom({
      protocols: new Map([['mock', { trailers: { [MOCK_ID_KEY]: ['match0002'] }, unauthorized: {} }]]),
      filesChanged: ['src/main.ts'],
    });
    const h = buildHarness([matching], [matching]);

    await h.program.parseAsync(['node', 'atom', 'log', '--', 'src/main.ts']);

    expect(h.repo.find).toHaveBeenCalledTimes(1);
    expect(h.repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ target: ['src/main.ts'] })
    );

    const result = (h.capturedResult.data as { result: { atoms: any[] } }).result;
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].protocols.get('mock').trailers[MOCK_ID_KEY][0]).toBe('match0002');
  });

  it('uses global find when no path argument is provided', async () => {
    const a = makeAtom({ filesChanged: ['src/a.ts'] });
    const b = makeAtom({ filesChanged: ['src/b.ts'] });
    const h = buildHarness([a, b]);

    await h.program.parseAsync(['node', 'atom', 'log']);

    expect(h.repo.find).toHaveBeenCalledTimes(1);
    expect(h.repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ target: [] })
    );

    const result = (h.capturedResult.data as { result: { atoms: Atom[] } }).result;
    expect(result.atoms).toHaveLength(2);
  });
});
