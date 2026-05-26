import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerLogCommand } from '../../../../src/engine/commands/log.js';
import type { AtomRepository } from '../../../../src/engine/services/atom-repository.js';
import type { SupersessionResolver } from '../../../../src/engine/services/supersession-resolver.js';
import type { IOutputFormatter } from '../../../../src/engine/interfaces/output-formatter.js';
import type { Atom } from '../../../../src/engine/types/domain.js';
import { LORE_DEFAULT_CONFIG } from '../../../../src/lore/defaults.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { LoreProtocolDefinition } from '../../../../src/lore/protocol-definition.js';

const LORE_ID_KEY = "Lore-id";


/**
 * Regression tests for issue #22: `lore log` must accept positional path
 * arguments (`lore log src/foo.ts`) and the `--` pass-through
 * (`lore log -- src/foo.ts`), routing to `findByTarget` for git-level
 * path filtering.
 *
 * Driven through Commander's parseAsync with mocked services.
 */

function makeAtom(overrides: Partial<Atom> & { filesChanged: readonly string[] }): Atom {
  const id = (overrides as any).id ?? (overrides as any).id ?? 'abcd1234';
  const protocols = new Map();
  protocols.set('lore', {
    name: 'lore',
    version: '1.0',
    identityKey: LORE_ID_KEY,
    trailers: {
      [LORE_ID_KEY]: [id],
      Constraint: [],
      Rejected: [],
      Confidence: [],
      'Scope-risk': [],
      Reversibility: [],
      Directive: [],
      Tested: [],
      'Not-tested': [],
      Supersedes: [],
      'Depends-on': [],
      Related: [],
    },
  });

  const base: Atom = {
    id,
    commitHash: 'a'.repeat(40),
    date: new Date('2026-01-01T00:00:00Z'),
    author: 'Tester <tester@example.com>',
    intent: 'fix: example',
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

import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';

function buildHarness(atoms: Atom[], filteredAtoms?: Atom[]): Harness {
  const findAll = vi.fn().mockResolvedValue(atoms);
  const findByTarget = vi.fn().mockResolvedValue(filteredAtoms ?? atoms);
  const atomRepository = { findAll, findByTarget } as unknown as AtomRepository;

  const supersessionResolver = {
    resolveAll: vi.fn().mockReturnValue(new Map([['lore', new Map()]])),
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

  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  const program = new Command();
  program.exitOverride();
  const protocol = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);
  const protocolRegistry = new ProtocolRegistry();
  protocolRegistry.register(protocol);

  registerLogCommand(program, {
    atomRepository,
    gitClient: {
      resolveRef: vi.fn().mockResolvedValue('head-hash'),
    } as any,
    supersessionResolver,
    getFormatter: () => formatter,
    config: LORE_DEFAULT_CONFIG,
    protocol,
  });

  return { program, capturedResult, findAll, findByTarget, consoleSpy };
}

describe('registerLogCommand (issue #22 path arguments)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a positional path and routes through findByTarget', async () => {
    const matching = makeAtom({
      id: 'match0001',
      filesChanged: ['src/main.ts'],
    });
    const h = buildHarness([matching], [matching]);

    await h.program.parseAsync(['node', 'lore', 'log', 'src/main.ts']);

    expect(h.findByTarget).toHaveBeenCalledTimes(1);
    expect(h.findByTarget).toHaveBeenCalledWith(
      ['--', 'src/main.ts'],
      expect.any(Object),
      'head-hash'
    );
    expect(h.findAll).not.toHaveBeenCalled();

    const result = (h.capturedResult.data as { result: { atoms: Atom[] } }).result;
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].id).toBe('match0001');
  });

  it('accepts the `--` pass-through and routes identically', async () => {
    const matching = makeAtom({
      id: 'match0002',
      filesChanged: ['src/main.ts'],
    });
    const h = buildHarness([matching], [matching]);

    await h.program.parseAsync(['node', 'lore', 'log', '--', 'src/main.ts']);

    expect(h.findByTarget).toHaveBeenCalledTimes(1);
    expect(h.findByTarget).toHaveBeenCalledWith(
      ['--', 'src/main.ts'],
      expect.any(Object),
      'head-hash'
    );

    const result = (h.capturedResult.data as { result: { atoms: Atom[] } }).result;
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].id).toBe('match0002');
  });

  it('uses findAll (not findByTarget) when no path argument is provided', async () => {
    const a = makeAtom({ id: 'all00001', filesChanged: ['src/a.ts'] });
    const b = makeAtom({ id: 'all00002', filesChanged: ['src/b.ts'] });
    const h = buildHarness([a, b]);

    await h.program.parseAsync(['node', 'lore', 'log']);

    expect(h.findAll).toHaveBeenCalledTimes(1);
    expect(h.findByTarget).not.toHaveBeenCalled();

    const result = (h.capturedResult.data as { result: { atoms: Atom[] } }).result;
    expect(result.atoms).toHaveLength(2);
  });

  it('combines --limit with a positional path argument (limit applied client-side)', async () => {
    const a = makeAtom({ id: 'limit001', filesChanged: ['src/main.ts'] });
    const b = makeAtom({ id: 'limit002', filesChanged: ['src/main.ts'] });
    const h = buildHarness([], [a, b]);

    await h.program.parseAsync(['node', 'lore', 'log', '--limit', '1', 'src/main.ts']);

    expect(h.findByTarget).toHaveBeenCalledTimes(1);
    expect(h.findByTarget).toHaveBeenCalledWith(
      ['--', 'src/main.ts'],
      expect.any(Object),
      'head-hash'
    );

    const result = (h.capturedResult.data as { result: { atoms: Atom[] } }).result;
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].id).toBe('limit001');
  });

  it('passes --max-commits to findByTarget as maxCommits in PathQueryOptions', async () => {
    const atom = makeAtom({ id: 'mc000001', filesChanged: ['src/main.ts'] });
    const h = buildHarness([], [atom]);

    await h.program.parseAsync(['node', 'lore', 'log', 'src/main.ts', '--max-commits', '50']);

    const queryOptions = h.findByTarget.mock.calls[0][1];
    expect(queryOptions.maxCommits).toBe(50);
  });

  it('reflects totalAtoms before --limit in meta', async () => {
    const atoms = [
      makeAtom({ id: 'meta0001', filesChanged: ['src/a.ts'] }),
      makeAtom({ id: 'meta0002', filesChanged: ['src/b.ts'] }),
      makeAtom({ id: 'meta0003', filesChanged: ['src/c.ts'] }),
    ];
    const h = buildHarness(atoms);

    await h.program.parseAsync(['node', 'lore', 'log', '--limit', '1']);

    const data = h.capturedResult.data as { result: { atoms: Atom[]; meta: { totalAtoms: number; filteredAtoms: number } } };
    expect(data.result.meta.totalAtoms).toBe(3);
    expect(data.result.meta.filteredAtoms).toBe(1);
    expect(data.result.atoms).toHaveLength(1);
  });
});
