import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executePathQuery } from '../../../../../src/engine/commands/helpers/path-query.js';
import type { PathQueryDeps, PathQueryCommandOptions } from '../../../../../src/engine/commands/helpers/path-query.js';
import type { Atom, SupersessionStatus } from '../../../../../src/engine/types/domain.js';
import { Protocol } from '../../../../../src/engine/services/protocol.js';
import { TEST_PROTOCOL_DEFINITION, TEST_ENGINE_CONFIG, TestLogger } from '../../test-utils.js';

const TEST_ID_KEY = "Mock-id";

function makeAtom(id: string, supersedes: string[] = []): Atom {
  const protocols = new Map();
  protocols.set('mock', {
    name: 'Mock',
    version: '1.0',
    identityKey: TEST_ID_KEY,
    trailers: {
      [TEST_ID_KEY]: [id],
      Supersedes: supersedes,
    },
  });

  return {
    commitHash: `hash_${id}`,
    date: new Date('2025-01-01'),
    author: 'test@example.com',
    subject: `feat: ${id}`,
    body: '',
    protocols,
    filesChanged: ['src/test.ts'],
  } as any;
}

describe('executePathQuery — --limit as post-supersession result cap', () => {
  let deps: PathQueryDeps;
  let mockFind: ReturnType<typeof vi.fn>;
  let mockResolve: ReturnType<typeof vi.fn>;
  let mockFilterActive: ReturnType<typeof vi.fn>;
  let formattedOutput: string;
  let logger: TestLogger;

  beforeEach(() => {
    mockFind = vi.fn();
    mockResolve = vi.fn();
    mockFilterActive = vi.fn();
    formattedOutput = '';
    logger = new TestLogger();

    deps = {
      atomRepository: {
        find: mockFind,
        findByScope: vi.fn(),
        resolveFollowLinks: vi.fn(),
      } as any,
      gitClient: {
          resolveRef: vi.fn().mockResolvedValue('head-hash'),
      } as any,
      supersessionResolver: {
        resolveAll: mockResolve,
        filterActive: mockFilterActive,
      } as any,
      pathResolver: {
        parseTarget: vi.fn().mockReturnValue({
          raw: 'src/test.ts',
          type: 'file',
          filePath: 'src/test.ts',
          lineStart: null,
          lineEnd: null,
        }),
        toGitLogArgs: vi.fn().mockReturnValue(['--', 'src/test.ts']),
      } as any,
      getFormatter: () => ({
        formatQueryResult: vi.fn().mockImplementation((data) => {
          formattedOutput = JSON.stringify({
            atoms: data.result.atoms.length,
            filteredAtoms: data.result.meta.filteredAtoms,
          });
          return formattedOutput;
        }),
      }) as any,
      config: TEST_ENGINE_CONFIG,
      logger,
    };
  });

  it('should apply --limit after supersession filtering', async () => {
    // 5 atoms from git, 2 are superseded, limit 2
    const atoms = [
      makeAtom('aaaa1111'),
      makeAtom('bbbb2222'),
      makeAtom('cccc3333', ['aaaa1111']),  // supersedes aaaa1111
      makeAtom('dddd4444', ['bbbb2222']),  // supersedes bbbb2222
      makeAtom('eeee5555'),
    ];

    mockFind.mockResolvedValue(atoms);

    const supersessionMap = new Map<string, SupersessionStatus>([
      ['aaaa1111', { superseded: true, supersededBy: 'cccc3333' }],
      ['bbbb2222', { superseded: true, supersededBy: 'dddd4444' }],
      ['cccc3333', { superseded: false, supersededBy: null }],
      ['dddd4444', { superseded: false, supersededBy: null }],
      ['eeee5555', { superseded: false, supersededBy: null }],
    ]);
    const globalSupersessionMap = new Map([['mock', supersessionMap]]);
    mockResolve.mockReturnValue(globalSupersessionMap);

    // filterActive returns only 3 non-superseded atoms
    const activeAtoms = [atoms[2], atoms[3], atoms[4]];
    mockFilterActive.mockReturnValue(activeAtoms);

    const options: PathQueryCommandOptions = { limit: 2 };
    await executePathQuery('src/test.ts', options, deps, 'context', 'all');

    // The output should have exactly 2 atoms (limit applied after supersession)
    const output = JSON.parse(logger.resultLogs[0]);
    expect(output.atoms).toBe(2);
    expect(output.filteredAtoms).toBe(2);
  });

  it('should not pass limit to atomRepository (only maxCommits)', async () => {
    mockFind.mockResolvedValue([]);
    mockResolve.mockReturnValue(new Map());
    mockFilterActive.mockReturnValue([]);

    const options: PathQueryCommandOptions = { limit: 5, maxCommits: 100 };
    await executePathQuery('src/test.ts', options, deps, 'context', 'all');

    // Verify findByTarget received maxCommits in PathQueryOptions
    const queryOptions = mockFind.mock.calls[0][0];
    expect(queryOptions.maxCommits).toBe(100);
    // limit is in the options but should NOT affect git scan (in repository call)
    expect(queryOptions.limit).toBeNull();
  });

  it('should return all atoms when limit is not specified', async () => {
    const atoms = [makeAtom('aaaa1111'), makeAtom('bbbb2222'), makeAtom('cccc3333')];

    mockFind.mockResolvedValue(atoms);
    mockResolve.mockReturnValue(new Map());
    mockFilterActive.mockReturnValue(atoms);

    const options: PathQueryCommandOptions = {};
    await executePathQuery('src/test.ts', options, deps, 'context', 'all');

    const output = JSON.parse(logger.resultLogs[0]);
    expect(output.atoms).toBe(3);
  });

  it('should treat limit 0 as no limit', async () => {
    const atoms = [makeAtom('aaaa1111'), makeAtom('bbbb2222')];

    mockFind.mockResolvedValue(atoms);
    mockResolve.mockReturnValue(new Map());
    mockFilterActive.mockReturnValue(atoms);

    const options: PathQueryCommandOptions = { limit: 0 };
    await executePathQuery('src/test.ts', options, deps, 'context', 'all');

    const output = JSON.parse(logger.resultLogs[0]);
    expect(output.atoms).toBe(2);
  });
});
