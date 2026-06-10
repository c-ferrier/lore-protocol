import { Command } from 'commander';
import { afterEach,describe, expect, it, vi } from 'vitest';

import { registerLogCommand } from '../../../../src/engine/cli/commands/log.js';
import { ProtocolMap } from '../../../../src/engine/core/models/protocol-map.js';
import { type Atom } from '../../../../src/engine/core/types/domain.js';
import * as Discovery from '../../../../src/engine/shell/orchestrators/discovery.js';
import { makeAtom, makeStubProtocolContext,type ProtocolContext,TEST_ID_KEY, TEST_PROTOCOL_DEFINITION } from '../../../../src/engine/testing.js';
import { makeMockFormatter, makeMockInfra, TestLogger } from '../../engine-test-utils.js';

vi.mock('../../../../src/engine/shell/orchestrators/discovery.js', () => ({
    findAtoms: vi.fn()
}));

/**
 * Regression tests for positional path arguments in log command.
 */

interface Harness {
  program: Command;
  capturedResult: { data: unknown };
  logger: TestLogger;
}

function buildHarness(atoms: Atom[], filteredAtoms?: Atom[]): Harness {
  vi.mocked(Discovery.findAtoms).mockResolvedValue(filteredAtoms ?? atoms);

  const capturedResult: { data: unknown } = { data: undefined };
  const formatter = makeMockFormatter();
  formatter.formatQueryResult.mockImplementation((data: unknown) => {
      capturedResult.data = data;
      return '';
  });

  const logger = new TestLogger();
  const program = new Command();
  program.exitOverride();

  const protocol = makeStubProtocolContext(TEST_PROTOCOL_DEFINITION);
  const protocols = new ProtocolMap<ProtocolContext>();
  protocols.set(protocol.name, protocol);

  const infra = makeMockInfra({
    getFormatter: () => formatter,
    logger,
    protocols,
    protocolRoot: '/mock',
    cwd: '/mock',
  });

  registerLogCommand(program, infra);

  return { program, capturedResult, logger };
}

describe('registerLogCommand (agnostic path arguments)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a positional path and routes through findAtoms()', async () => {
    const matching = makeAtom({ 
        protocols: new Map([['mock', { trailers: { [TEST_ID_KEY]: ['match0002'] }, unauthorized: {} }]]),
        filesChanged: ['src/main.ts'],
        subject: 'feat(main): change' 
    });
    const h = buildHarness([matching], [matching]);

    await h.program.parseAsync(['node', 'atom', 'log', 'src/main.ts']);

    expect(Discovery.findAtoms).toHaveBeenCalledTimes(1);
    const target = vi.mocked(Discovery.findAtoms).mock.calls[0][1];
    expect(target.resolvedPaths).toContain('src/main.ts');

    const result = (h.capturedResult.data as { result: { atoms: Atom[] } }).result;
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].protocols.get('mock')!.trailers[TEST_ID_KEY][0]).toBe('match0002');
  });

  it('accepts the `--` pass-through and routes identically', async () => {
    const matching = makeAtom({
      protocols: new Map([['mock', { trailers: { [TEST_ID_KEY]: ['match0002'] }, unauthorized: {} }]]),
      filesChanged: ['src/main.ts'],
    });
    const h = buildHarness([matching], [matching]);

    await h.program.parseAsync(['node', 'atom', 'log', '--', 'src/main.ts']);

    expect(Discovery.findAtoms).toHaveBeenCalledTimes(1);
    const target = vi.mocked(Discovery.findAtoms).mock.calls[0][1];
    expect(target.resolvedPaths).toContain('src/main.ts');

    const result = (h.capturedResult.data as { result: { atoms: Atom[] } }).result;
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].protocols.get('mock')!.trailers[TEST_ID_KEY][0]).toBe('match0002');
  });

  it('uses global find when no path argument is provided', async () => {
    const a = makeAtom({ filesChanged: ['src/a.ts'] });
    const b = makeAtom({ filesChanged: ['src/b.ts'] });
    const h = buildHarness([a, b]);

    await h.program.parseAsync(['node', 'atom', 'log']);

    expect(Discovery.findAtoms).toHaveBeenCalledTimes(1);
    const target = vi.mocked(Discovery.findAtoms).mock.calls[0][1];
    expect(target.type).toBe('global');

    const result = (h.capturedResult.data as { result: { atoms: Atom[] } }).result;
    expect(result.atoms).toHaveLength(2);
  });
});