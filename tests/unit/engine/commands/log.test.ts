import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerLogCommand } from '../../../../src/engine/commands/log.js';
import type { AtomRepository } from '../../../../src/engine/services/atom-repository.js';
import type { SupersessionResolver } from '../../../../src/engine/services/supersession-resolver.js';
import type { IOutputFormatter } from '../../../../src/engine/interfaces/output-formatter.js';
import type { Atom } from '../../../../src/engine/types/domain.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG, MockLogger, makeProtocol } from '../test-utils.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';

const MOCK_ID_KEY = "Mock-id";

/**
 * Regression tests for positional path arguments in log command.
 */

function makeAtom(overrides: Partial<Atom> & { filesChanged: readonly string[] }): Atom {
  const id = (overrides as any).id ?? 'abcd1234';
  const protocols = new Map();
  protocols.set('mock', {
    name: 'Mock',
    version: '1.0',
    identityKey: MOCK_ID_KEY,
    trailers: {
      [MOCK_ID_KEY]: [id],
    },
  });

  const base: Atom = {
    commitHash: 'a'.repeat(40),
    date: new Date('2026-01-01T00:00:00Z'),
    author: 'Tester <tester@example.com>',
    subject: 'fix: example',
    body: '',
    protocols,
    filesChanged: overrides.filesChanged,
  };

  return { ...base, ...overrides };
}

interface Harness {
  program: Command;
  capturedResult: { data: unknown };
  findAll: ReturnType<typeof vi.fn>;
  findByTarget: ReturnType<typeof vi.fn>;
  consoleSpy: ReturnType<typeof vi.spyOn>;
}

function buildHarness(atoms: Atom[], filteredAtoms?: Atom[]): Harness {
  const findAll = vi.fn().mockResolvedValue(atoms);
  const findByTarget = vi.fn().mockResolvedValue(filteredAtoms ?? atoms);
  const findAtoms = vi.fn().mockResolvedValue(filteredAtoms ?? atoms);
  const findByScope = vi.fn().mockResolvedValue([]);
  const atomRepository = { findAll, findByTarget, findAtoms, findByScope } as unknown as AtomRepository;

  const supersessionResolver = {
    resolveAll: vi.fn().mockReturnValue(new Map([['mock', new Map()]])),
    filterActive: vi.fn((atoms: Atom[]) => atoms),
  } as unknown as SupersessionResolver;

  const capturedResult: { data: unknown } = { data: undefined };
  const formatQueryResult = vi.fn((data: unknown) => {
    capturedResult.data = data;
    return '';
  });

  const formatter = {
    formatQueryResult,
    formatValidationResult: vi.fn(),
    formatStalenessResult: vi.fn(),
    formatTraceResult: vi.fn(),
    formatDoctorResult: vi.fn(),
    formatSuccess: vi.fn(),
    formatError: vi.fn(),
  } as IOutputFormatter;

  const logger = new MockLogger();

  const program = new Command();
  program.exitOverride();
  const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
  const protocolRegistry = new ProtocolRegistry();
  protocolRegistry.register(protocol);

  registerLogCommand(program, {
    atomRepository,
    gitClient: {
      resolveRef: vi.fn().mockResolvedValue('head-hash'),
    } as any,
    supersessionResolver,
    getFormatter: () => formatter,
    logger,
  });

  return { program, capturedResult, findAll, findByTarget, findAtoms, findByScope, logger };
}

describe('registerLogCommand (agnostic path arguments)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a positional path and routes through findByTarget', async () => {
    const matching = makeAtom({
      id: 'match0001',
      filesChanged: ['src/main.ts'],
    });
    const h = buildHarness([matching], [matching]);

    await h.program.parseAsync(['node', 'atom', 'log', 'src/main.ts']);

    expect(h.findAtoms).toHaveBeenCalledTimes(1);
    expect(h.findAtoms).toHaveBeenCalledWith(
      ['src/main.ts'],
      expect.any(Object)
    );
    expect(h.findAll).not.toHaveBeenCalled();

    const result = (h.capturedResult.data as { result: { atoms: any[] } }).result;
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].protocols.get('mock').trailers[MOCK_ID_KEY][0]).toBe('match0001');
  });

  it('accepts the `--` pass-through and routes identically', async () => {
    const matching = makeAtom({
      id: 'match0002',
      filesChanged: ['src/main.ts'],
    });
    const h = buildHarness([matching], [matching]);

    await h.program.parseAsync(['node', 'atom', 'log', '--', 'src/main.ts']);

    expect(h.findAtoms).toHaveBeenCalledTimes(1);
    expect(h.findAtoms).toHaveBeenCalledWith(
      ['src/main.ts'],
      expect.any(Object)
    );

    const result = (h.capturedResult.data as { result: { atoms: any[] } }).result;
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].protocols.get('mock').trailers[MOCK_ID_KEY][0]).toBe('match0002');
  });

  it('uses findAll (not findByTarget) when no path argument is provided', async () => {
    const a = makeAtom({ id: 'all00001', filesChanged: ['src/a.ts'] });
    const b = makeAtom({ id: 'all00002', filesChanged: ['src/b.ts'] });
    const h = buildHarness([a, b]);

    await h.program.parseAsync(['node', 'atom', 'log']);

    expect(h.findAll).toHaveBeenCalledTimes(1);
    expect(h.findByTarget).not.toHaveBeenCalled();

    const result = (h.capturedResult.data as { result: { atoms: Atom[] } }).result;
    expect(result.atoms).toHaveLength(2);
  });
});
