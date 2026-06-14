import { Command } from 'commander';
import { afterEach,describe, expect, it, vi } from 'vitest';

import { registerLogCommand } from '../../../../src/engine/cli/commands/log.js';
import { type Atom } from '../../../../src/engine/core/types/domain.js';
import * as Discovery from '../../../../src/engine/shell/orchestrators/discovery.js';
import { makeAtom, makeStubProtocolContext, makeStubProtocolMap, makeStubProtocolState, TEST_ID_KEY, TEST_PROTOCOL_DEFINITION } from '../../../../src/engine/testing.js';
import { makeMockFormatter, makeMockInfra, TestLogger } from '../../engine-test-utils.js';

vi.mock('../../../../src/engine/shell/orchestrators/discovery.js', () => ({
    findAtoms: vi.fn(),
    findAtomsStream: vi.fn()
}));

/**
 * Regression tests for positional path arguments in log command.
 */

interface Harness {
  program: Command;
  capturedAtoms: Atom[];
  logger: TestLogger;
}

function buildHarness(atoms: Atom[], filteredAtoms?: Atom[]): Harness {
  const targetAtoms = filteredAtoms ?? atoms;
  vi.mocked(Discovery.findAtomsStream).mockImplementation(async function* () {
      for (const atom of targetAtoms) {
          yield atom;
      }
  });

  const capturedAtoms: Atom[] = [];
  const formatter = makeMockFormatter();
  formatter.formatQueryAtom.mockImplementation((atom: Atom) => {
      capturedAtoms.push(atom);
      return '';
  });
  formatter.formatQueryHeader.mockReturnValue('');
  formatter.formatQueryFooter.mockReturnValue('');


  const logger = new TestLogger();
  const program = new Command();
  program.exitOverride();

  const protocols = makeStubProtocolMap([makeStubProtocolContext(TEST_PROTOCOL_DEFINITION)]);

  const infra = makeMockInfra({
    getFormatter: () => formatter,
    logger,
    protocols,
    protocolRoot: '/mock',
    cwd: '/mock',
  });

  registerLogCommand(program, infra);

  return { program, capturedAtoms, logger };
}

describe('registerLogCommand (agnostic path arguments)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a positional path and routes through findAtoms()', async () => {
    const matching = makeAtom({ 
        protocols: makeStubProtocolMap([
            ['mock', makeStubProtocolState({ trailers: { [TEST_ID_KEY]: ['match0002'] } })]
        ]),
        filesChanged: ['src/main.ts'],
        subject: 'feat(main): change' 
    });
    const h = buildHarness([matching], [matching]);

    await h.program.parseAsync(['node', 'atom', 'log', 'src/main.ts']);

    expect(Discovery.findAtomsStream).toHaveBeenCalledTimes(1);
    const target = vi.mocked(Discovery.findAtomsStream).mock.calls[0][1];
    expect(target.resolvedPaths).toContain('src/main.ts');

    expect(h.capturedAtoms).toHaveLength(1);
    expect(h.capturedAtoms[0].protocols.get('mock')!.trailers[TEST_ID_KEY][0]).toBe('match0002');
  });

  it('accepts the `--` pass-through and routes identically', async () => {
    const matching = makeAtom({
      protocols: makeStubProtocolMap([
          ['mock', makeStubProtocolState({ trailers: { [TEST_ID_KEY]: ['match0002'] } })]
      ]),
      filesChanged: ['src/main.ts'],
    });
    const h = buildHarness([matching], [matching]);


    await h.program.parseAsync(['node', 'atom', 'log', '--', 'src/main.ts']);

    expect(Discovery.findAtomsStream).toHaveBeenCalledTimes(1);
    const target = vi.mocked(Discovery.findAtomsStream).mock.calls[0][1];
    expect(target.resolvedPaths).toContain('src/main.ts');

    expect(h.capturedAtoms).toHaveLength(1);
    expect(h.capturedAtoms[0].protocols.get('mock')!.trailers[TEST_ID_KEY][0]).toBe('match0002');
  });

  it('uses global find when no path argument is provided', async () => {
    const a = makeAtom({ filesChanged: ['src/a.ts'] });
    const b = makeAtom({ filesChanged: ['src/b.ts'] });
    const h = buildHarness([a, b]);

    await h.program.parseAsync(['node', 'atom', 'log']);

    expect(Discovery.findAtomsStream).toHaveBeenCalledTimes(1);
    const target = vi.mocked(Discovery.findAtomsStream).mock.calls[0][1];
    expect(target.type).toBe('global');

    expect(h.capturedAtoms).toHaveLength(2);
  });
});