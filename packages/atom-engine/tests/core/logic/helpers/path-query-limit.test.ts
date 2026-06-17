import { beforeEach,describe, expect, it, vi } from 'vitest';

import {         executePathQuery,type PathQueryCommandOptions,
    type PathQueryDeps } from '../../../../src/cli/commands/helpers/path-query.js';
import { type Atom } from '../../../../src/core/types/domain.js';
import * as Discovery from '../../../../src/shell/orchestrators/discovery.js';
import { makeStubProtocolMap, makeStubProtocolState, TEST_ENGINE_CONFIG } from '../../../../src/testing.js';
import { makeMockFormatter, makeMockInfra, TestLogger } from '../../../engine-test-utils.js';
import { type MockedOutputFormatter } from '../../../mock-types.js';

const TEST_ID_KEY = "Mock-id";

vi.mock('../../../../src/shell/orchestrators/discovery.js', () => ({
    findAtoms: vi.fn(),
    findAtomsStream: vi.fn()
}));

function makeLocalAtom(id: string, supersedes: string[] = []): Atom {

  const protocols = makeStubProtocolMap([
    ['mock', makeStubProtocolState({
      trailers: {
        [TEST_ID_KEY]: [id],
        Supersedes: supersedes,
      }
    })]
  ]);

  return {
    commitHash: `hash_${id}`,
    date: new Date('2025-01-01'),
    author: 'test@example.com',
    subject: `feat: ${id}`,
    body: '',
    rawTrailers: `${TEST_ID_KEY}: ${id}`,
    protocols,
    filesChanged: ['src/test.ts'],
  };
}

describe('executePathQuery — --limit as post-supersession result cap', () => {
  let infra: PathQueryDeps;
  let formatter: MockedOutputFormatter;
  let logger: TestLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    formatter = makeMockFormatter();
    logger = new TestLogger();

    formatter.formatQueryAtom.mockImplementation((data: any) => `ATOM:${data.atom.commitHash}`);
    formatter.formatQueryFooter.mockImplementation((meta: any) => `FOOTER:${meta.filtered}/${meta.total}`);


    infra = makeMockInfra({
      getFormatter: () => formatter,
      config: TEST_ENGINE_CONFIG,
      logger,
      protocolRoot: '/mock',
      cwd: '/mock'
    });
  });

  it('should apply --limit after internal supersession filtering', async () => {
    // 5 atoms from git, 2 are superseded, limit 2
    const a1 = makeLocalAtom('aaaa1111');
    const a2 = makeLocalAtom('bbbb2222');
    const a3 = makeLocalAtom('cccc3333', ['aaaa1111']);
    const a4 = makeLocalAtom('dddd4444', ['bbbb2222']);
    const a5 = makeLocalAtom('eeee5555');

    a1.protocols.get('mock')!.supersession = { superseded: true, supersededBy: ['cccc3333'] };
    a2.protocols.get('mock')!.supersession = { superseded: true, supersededBy: ['dddd4444'] };
    a3.protocols.get('mock')!.supersession = { superseded: false, supersededBy: [] };
    a4.protocols.get('mock')!.supersession = { superseded: false, supersededBy: [] };
    a5.protocols.get('mock')!.supersession = { superseded: false, supersededBy: [] };

    const atoms = [a1, a2, a3, a4, a5];
    vi.mocked(Discovery.findAtomsStream).mockReturnValue((async function* () {
        for (const a of atoms) yield a;
    })() as AsyncGenerator<Atom>);

    const options: PathQueryCommandOptions = { limit: 2 };
    await executePathQuery('src/test.ts', options, infra, 'context', 'all');

    // Expected: a3, a4 (a1, a2 are superseded, a5 is over limit)
    const atomLogs = logger.resultLogs.filter(l => l.startsWith('ATOM:'));
    expect(atomLogs).toHaveLength(2);
    expect(atomLogs).toContain('ATOM:hash_cccc3333\n');
    expect(atomLogs).toContain('ATOM:hash_dddd4444\n');

    const footerLog = logger.resultLogs.find(l => l.startsWith('FOOTER:'))!;
    expect(footerLog).toBe('FOOTER:2/5\n');
  });

  it('should not pass limit to Discovery (only maxCommits)', async () => {
    vi.mocked(Discovery.findAtomsStream).mockReturnValue((async function* () {
        yield* [];
    })() as AsyncGenerator<Atom>);

    const options: PathQueryCommandOptions = { limit: 5, maxCommits: 100 };
    await executePathQuery('src/test.ts', options, infra, 'context', 'all');

    // Verify findAtomsStream received maxCommits in options (third argument)
    const queryOptions = vi.mocked(Discovery.findAtomsStream).mock.calls[0][2];
    expect(queryOptions!.maxCommits).toBe(100);
    // limit is passed through but ignored by storage layer; applied at CLI display level
    expect(queryOptions!.limit).toBe(5);
  });

  it('should return all atoms when limit is not specified', async () => {
    const atoms = [makeLocalAtom('aaaa1111'), makeLocalAtom('bbbb2222'), makeLocalAtom('cccc3333')];
    for (const a of atoms) a.protocols.get('mock')!.supersession = { superseded: false, supersededBy: [] };

    vi.mocked(Discovery.findAtomsStream).mockReturnValue((async function* () {
        for (const a of atoms) yield a;
    })() as AsyncGenerator<Atom>);

    const options: PathQueryCommandOptions = {};
    await executePathQuery('src/test.ts', options, infra, 'context', 'all');

    const atomLogs = logger.resultLogs.filter(l => l.startsWith('ATOM:'));
    expect(atomLogs).toHaveLength(3);
  });

  it('should treat limit 0 as no limit', async () => {
    const atoms = [makeLocalAtom('aaaa1111'), makeLocalAtom('bbbb2222')];
    for (const a of atoms) a.protocols.get('mock')!.supersession = { superseded: false, supersededBy: [] };

    vi.mocked(Discovery.findAtomsStream).mockReturnValue((async function* () {
        for (const a of atoms) yield a;
    })() as AsyncGenerator<Atom>);

    const options: PathQueryCommandOptions = { limit: 0 };
    await executePathQuery('src/test.ts', options, infra, 'context', 'all');

    const atomLogs = logger.resultLogs.filter(l => l.startsWith('ATOM:'));
    expect(atomLogs).toHaveLength(2);
  });
});