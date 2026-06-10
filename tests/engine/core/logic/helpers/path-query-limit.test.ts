import { beforeEach,describe, expect, it, vi } from 'vitest';

import {         executePathQuery,type PathQueryCommandOptions,
    type PathQueryDeps } from '../../../../../src/engine/cli/commands/helpers/path-query.js';
import { type Atom, ProtocolMap, type ProtocolState } from '../../../../../src/engine/core/types/domain.js';
import * as Discovery from '../../../../../src/engine/shell/orchestrators/discovery.js';
import { TEST_ENGINE_CONFIG } from '../../../../../src/engine/testing.js';
import { type MockedOutputFormatter } from '../../../../mock-types.js';
import { makeMockFormatter, makeMockInfra, TestLogger } from '../../../engine-test-utils.js';

const TEST_ID_KEY = "Mock-id";

vi.mock('../../../../../src/engine/shell/orchestrators/discovery.js', () => ({
    findAtoms: vi.fn()
}));

function makeLocalAtom(id: string, supersedes: string[] = []): Atom {
  const protocols = new ProtocolMap<ProtocolState>();
  protocols.set('mock', {
    trailers: {
      [TEST_ID_KEY]: [id],
      Supersedes: supersedes,
    },
    unauthorized: {}
  });

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
  let formattedOutput: string;
  let logger: TestLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    formatter = makeMockFormatter();
    formattedOutput = '';
    logger = new TestLogger();

    formatter.formatQueryResult.mockImplementation((data) => {
        formattedOutput = JSON.stringify({
          atoms: data.result.atoms.length,
          filteredAtoms: data.result.meta.filteredAtoms,
        });
        return formattedOutput;
    });

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
    vi.mocked(Discovery.findAtoms).mockResolvedValue(atoms);

    const options: PathQueryCommandOptions = { limit: 2 };
    await executePathQuery('src/test.ts', options, infra, 'context', 'all');

    // The output should have exactly 2 atoms (limit applied after supersession filtering)
    // Active atoms are a3, a4, a5. Limit 2 takes a3, a4.
    const output = JSON.parse(logger.resultLogs[0]);
    expect(output.atoms).toBe(2);
    expect(output.filteredAtoms).toBe(2);
  });

  it('should not pass limit to Discovery (only maxCommits)', async () => {
    vi.mocked(Discovery.findAtoms).mockResolvedValue([]);

    const options: PathQueryCommandOptions = { limit: 5, maxCommits: 100 };
    await executePathQuery('src/test.ts', options, infra, 'context', 'all');

    // Verify findAtoms received maxCommits in options (third argument)
    const queryOptions = vi.mocked(Discovery.findAtoms).mock.calls[0][2];
    expect(queryOptions!.maxCommits).toBe(100);
    // limit is in the options but should NOT affect git scan (in orchestrator call)
    expect(queryOptions!.limit).toBeNull();
  });

  it('should return all atoms when limit is not specified', async () => {
    const atoms = [makeLocalAtom('aaaa1111'), makeLocalAtom('bbbb2222'), makeLocalAtom('cccc3333')];
    for (const a of atoms) a.protocols.get('mock')!.supersession = { superseded: false, supersededBy: [] };

    vi.mocked(Discovery.findAtoms).mockResolvedValue(atoms);

    const options: PathQueryCommandOptions = {};
    await executePathQuery('src/test.ts', options, infra, 'context', 'all');

    const output = JSON.parse(logger.resultLogs[0]);
    expect(output.atoms).toBe(3);
  });

  it('should treat limit 0 as no limit', async () => {
    const atoms = [makeLocalAtom('aaaa1111'), makeLocalAtom('bbbb2222')];
    for (const a of atoms) a.protocols.get('mock')!.supersession = { superseded: false, supersededBy: [] };

    vi.mocked(Discovery.findAtoms).mockResolvedValue(atoms);

    const options: PathQueryCommandOptions = { limit: 0 };
    await executePathQuery('src/test.ts', options, infra, 'context', 'all');

    const output = JSON.parse(logger.resultLogs[0]);
    expect(output.atoms).toBe(2);
  });
});