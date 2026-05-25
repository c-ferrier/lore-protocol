import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { SearchFilter } from '../../../src/engine/services/search-filter.js';
import { NullAtomCache } from '../../../src/engine/services/atom-cache.js';
import { NullQueryCache } from '../../../src/engine/services/query-cache.js';
import type { IGitClient, RawCommit } from '../../../src/engine/interfaces/git-client.js';
import type { PathQueryOptions } from '../../../src/engine/types/query.js';
import type { Trailers } from '../../../src/engine/types/domain.js';
import { LORE_DEFAULT_CONFIG } from '../../../src/lore/defaults.js';
import { TrailerParser } from '../../../src/engine/services/trailer-parser.js';

const LORE_ID_KEY = "Lore-id";

/**
 * Minimal TrailerParser mock that satisfies the AtomRepository's usage.
 */
function createMockTrailerParser() {
  return {
    parse: vi.fn((rawTrailers: string): any => {
      const parser = new TrailerParser();
      return parser.parse(rawTrailers);
    }),
    serialize: vi.fn(() => ''),
    extractTrailerBlock: vi.fn(() => ''),
  };
}

/**
 * Simple trailer text parser for tests.
 * Extracts key: value pairs from a multi-line trailer block.
 */
function parseTrailersFromText(raw: string): Trailers {
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  
  const result: any = {
    [LORE_ID_KEY]: [],
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
  };

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    const value = line.substring(colonIdx + 1).trim();

    if (result[key]) {
      result[key].push(value);
    } else {
      result[key] = [value];
    }
  }

  return result;
}

function createMockGitClient(overrides: Partial<IGitClient> = {}): IGitClient {
  return {
    log: vi.fn(async () => []),
    blame: vi.fn(async () => []),
    commit: vi.fn(async () => ({ hash: 'abc123', success: true })),
    hasStagedChanges: vi.fn(async () => false),
    getRepoRoot: vi.fn(async () => '/repo'),
    isInsideRepo: vi.fn(async () => true),
    getFilesChanged: vi.fn(async (hashes: string[]) => {
      const map = new Map<string, string[]>();
      for (const hash of hashes) {
        map.set(hash, []);
      }
      return map;
    }),
    countCommitsSince: vi.fn(async () => 0),
    resolveRef: vi.fn(async () => 'abc123'),
    resolveDate: vi.fn(async (d: string) => {
      const date = new Date(d);
      return isNaN(date.getTime()) ? null : date;
    }),
    getHeadMessage: vi.fn(async () => 'message'),
    getCommitsByHashes: vi.fn(async () => []),
    ...overrides,
  } as any;
}

function makeLoreCommit(options: {
  hash?: string;
  date?: string;
  author?: string;
  subject?: string;
  body?: string;
  id?: string;
  trailerExtras?: string;
}): RawCommit {
  const id = options.id ?? 'a1b2c3d4';
  const extras = options.trailerExtras ?? '';
  return {
    hash: options.hash ?? 'abc12345',
    date: options.date ?? '2025-01-15T10:00:00Z',
    author: options.author ?? 'dev@example.com',
    subject: options.subject ?? 'feat(auth): add login',
    body: options.body ?? 'Implemented login flow.',
    trailers: `${LORE_ID_KEY}: ${id}\n${extras}`.trim(),
  };
}

function makeGitLogArgs(filePath: string = 'src/auth.ts'): readonly string[] {
  return ['--', filePath];
}

function makeQueryOptions(overrides: Partial<PathQueryOptions> = {}): PathQueryOptions {
  return {
    scope: null,
    follow: false,
    all: false,
    author: null,
    limit: null,
    maxCommits: null,
    since: null,
    until: null,
    ...overrides,
  };
}

describe('AtomRepository', () => {
  let gitClient: IGitClient;
  let trailerParser: ReturnType<typeof createMockTrailerParser>;
  let repo: AtomRepository;
  let protocol: Protocol;
  let protocolRegistry: ProtocolRegistry;
  let searchFilter: SearchFilter;
  let atomCache: NullAtomCache;
  let queryCache: NullQueryCache;

  beforeEach(() => {
    gitClient = createMockGitClient();
    trailerParser = createMockTrailerParser();
    protocol = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);
    protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(protocol);
    searchFilter = new SearchFilter(protocolRegistry);
    atomCache = new NullAtomCache();
    queryCache = new NullQueryCache();
    repo = new AtomRepository(gitClient, trailerParser as any, protocol, protocolRegistry, searchFilter, atomCache, queryCache);
  });

  describe('findByTarget', () => {
    it('should return atoms for a file target', async () => {
      const commit = makeLoreCommit({ id: 'a1b2c3d4' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['abc12345', ['src/auth.ts']]]));

      const gitLogArgs = makeGitLogArgs();
      const options = makeQueryOptions();
      const result = await repo.findByTarget(gitLogArgs, options);

      expect(result).toHaveLength(1);
      expect(result[0].protocols.get('lore')?.trailers['Lore-id']?.[0]).toBe('a1b2c3d4');
      expect(result[0].commitHash).toBe('abc12345');
      expect(result[0].author).toBe('dev@example.com');
      expect(result[0].filesChanged).toEqual(['src/auth.ts']);
    });

    it('should filter out non-Lore commits', async () => {
      const loreCommit = makeLoreCommit({ id: 'a1b2c3d4' });
      const nonLoreCommit: RawCommit = {
        hash: 'def456',
        date: '2025-01-16T10:00:00Z',
        author: 'dev@example.com',
        subject: 'chore: update deps',
        body: '',
        trailers: '',
      };

      vi.mocked(gitClient.log).mockResolvedValue([loreCommit, nonLoreCommit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['abc12345', ['src/auth.ts']]]));

      const result = await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(result).toHaveLength(1);
      expect(result[0].protocols.get('lore')?.trailers['Lore-id']?.[0]).toBe('a1b2c3d4');
    });

    it('should pass author filter to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const options = makeQueryOptions({ author: 'alice@example.com' });
      await repo.findByTarget(makeGitLogArgs(), options);

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--author=alice@example\\.com');
    });

    it('should pass since filter to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const options = makeQueryOptions({ since: '2025-01-01' });
      await repo.findByTarget(makeGitLogArgs(), options);

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--since=2025-01-01T00:00:00.000Z');
    });

    it('should pass until filter to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const options = makeQueryOptions({ until: '2025-06-01' });
      await repo.findByTarget(makeGitLogArgs(), options);

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--until=2025-06-01T00:00:00.000Z');
    });

    it('should pass maxCommits to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const options = makeQueryOptions({ maxCommits: 5 });
      await repo.findByTarget(makeGitLogArgs(), options);

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--max-count=5');
    });

    it('should return empty array when no commits match', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const result = await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(result).toEqual([]);
    });

    it('should apply author filter at the application level', async () => {
      const commit1 = makeLoreCommit({ hash: 'aaa', author: 'alice@example.com', id: 'aaaa1111' });
      const commit2 = makeLoreCommit({ hash: 'bbb', author: 'bob@example.com', id: 'bbbb2222' });
      vi.mocked(gitClient.log).mockResolvedValue([commit1, commit2]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['aaa', ['src/auth.ts']], ['bbb', ['src/auth.ts']]]));

      const options = makeQueryOptions({ author: 'alice' });
      const result = await repo.findByTarget(makeGitLogArgs(), options);

      expect(result).toHaveLength(1);
      expect(result[0].author).toBe('alice@example.com');
    });

    it('should not apply limit at the repository level (caller responsibility)', async () => {
      const commits = [
        makeLoreCommit({ hash: 'aaa', id: 'aaaa1111' }),
        makeLoreCommit({ hash: 'bbb', id: 'bbbb2222' }),
        makeLoreCommit({ hash: 'ccc', id: 'cccc3333' }),
      ];
      vi.mocked(gitClient.log).mockResolvedValue(commits);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map(commits.map(c => [c.hash, ['src/auth.ts']])));

      const options = makeQueryOptions({ limit: 2 });
      const result = await repo.findByTarget(makeGitLogArgs(), options);

      expect(result).toHaveLength(3);
    });
  });

  describe('findById', () => {
    it(`should find an atom by its ${LORE_ID_KEY}`, async () => {
      const commit = makeLoreCommit({ id: 'deadbeef' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[commit.hash, ['src/auth.ts']]]));

      const result = await repo.findById('deadbeef');

      expect(result).not.toBeNull();
      expect(result!.protocols.get('lore')?.trailers['Lore-id']?.[0]).toBe('deadbeef');
    });

    it(`should return null if no atom matches the ${LORE_ID_KEY}`, async () => {
      const commit = makeLoreCommit({ id: 'a1b2c3d4' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map());

      const result = await repo.findById('deadbeef');

      expect(result).toBeNull();
    });

    it(`should return null for invalid ${LORE_ID_KEY} format`, async () => {
      const result = await repo.findById('not-valid');

      expect(result).toBeNull();
      expect(gitClient.log).not.toHaveBeenCalled();
    });

    it(`should return null for empty ${LORE_ID_KEY}`, async () => {
      const result = await repo.findById('');

      expect(result).toBeNull();
    });

    it('should append path scope when isScoped=true', async () => {
      const scopedRepo = new AtomRepository(gitClient, trailerParser as any, protocol, protocolRegistry, searchFilter, atomCache, queryCache, true);
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await scopedRepo.findById('deadbeef');

      expect(gitClient.log).toHaveBeenCalledWith(
        expect.arrayContaining(['--', '.']),
      );
    });
  });

  describe('findByCommitHash', () => {
    it('should fetch and parse a single commit', async () => {
      const commit = makeLoreCommit({ hash: 'abc123', id: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['abc123', []]]));

      const result = await repo.findByCommitHash('abc123');

      expect(result).not.toBeNull();
      expect(result?.commitHash).toBe('abc123');
      expect(gitClient.log).toHaveBeenCalledWith(expect.arrayContaining(['-1', 'abc123']));
    });

    it('should return null if no commit found', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const result = await repo.findByCommitHash('abc123');
      expect(result).toBeNull();
    });

    it('should append path scope when isScoped=true', async () => {
      const scopedRepo = new AtomRepository(gitClient, trailerParser as any, protocol, protocolRegistry, searchFilter, atomCache, queryCache, true);
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await scopedRepo.findByCommitHash('abc123');

      expect(gitClient.log).toHaveBeenCalledWith(
        expect.arrayContaining(['-1', 'abc123', '--', '.']),
      );
    });
  });

  describe('findByRange', () => {
    it('should pass the range directly to git log', async () => {
      await repo.findByRange('main..HEAD');
      expect(gitClient.log).toHaveBeenCalledWith(['main..HEAD']);
    });

    it('should append path scope when isScoped=true', async () => {
      const scopedRepo = new AtomRepository(gitClient, trailerParser as any, protocol, protocolRegistry, searchFilter, atomCache, queryCache, true);
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await scopedRepo.findByRange('main..HEAD');

      expect(gitClient.log).toHaveBeenCalledWith(['main..HEAD', '--', '.']);
    });
  });

  describe('findAll', () => {
    it('should return all Lore atoms', async () => {
      const commits = [
        makeLoreCommit({ hash: 'aaa', id: 'aaaa1111' }),
        makeLoreCommit({ hash: 'bbb', id: 'bbbb2222' }),
      ];
      vi.mocked(gitClient.log).mockResolvedValue(commits);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['aaa', []], ['bbb', []]]));

      const result = await repo.findAll();

      expect(result).toHaveLength(2);
    });

    it('should strip trailers from body when body is exactly the trailer block', async () => {
      const trailersRaw = `${LORE_ID_KEY}: aaaa1111\nDirective: keep simple`;
      const commit: RawCommit = {
        hash: 'aaa',
        date: '2025-01-15T10:00:00Z',
        author: 'dev@example.com',
        subject: 'feat: no body',
        body: trailersRaw,
        trailers: trailersRaw,
      };
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['aaa', []]]));

      const result = await repo.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('');
    });

    it('should pass since option to git log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await repo.findAll({ since: '2025-01-01' });

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--since=2025-01-01T00:00:00.000Z');
    });

    it('should pass until option to git log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await repo.findAll({ until: '2025-06-01' });

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--until=2025-06-01T00:00:00.000Z');
    });

    it('should pass maxCommits option to git log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await repo.findAll({ maxCommits: 10 });

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--max-count=10');
    });

    it('should return empty array when no Lore commits exist', async () => {
      const nonLoreCommit: RawCommit = {
        hash: 'abc',
        date: '2025-01-15T10:00:00Z',
        author: 'dev@example.com',
        subject: 'chore: update deps',
        body: '',
        trailers: '',
      };
      vi.mocked(gitClient.log).mockResolvedValue([nonLoreCommit]);

      const result = await repo.findAll();

      expect(result).toEqual([]);
    });

    it('should append path scope when isScoped=true', async () => {
      const scopedRepo = new AtomRepository(gitClient, trailerParser as any, protocol, protocolRegistry, searchFilter, atomCache, queryCache, true);
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await scopedRepo.findAll();

      expect(gitClient.log).toHaveBeenCalledWith(
        expect.arrayContaining(['--', '.']),
      );
    });
  });

  describe('findAll with scope', () => {
    it('should find atoms matching the scope', async () => {
      const authCommit = makeLoreCommit({ subject: 'feat(auth): add login', id: 'aaaa1111' });
      const dbCommit = makeLoreCommit({ subject: 'fix(database): fix query', id: 'bbbb2222' });
      vi.mocked(gitClient.log).mockResolvedValue([authCommit, dbCommit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[authCommit.hash, []], [dbCommit.hash, []]]));

      const result = await repo.findAll({ ...makeQueryOptions(), scope: 'auth' });

      expect(result).toHaveLength(1);
      expect(result[0].protocols.get('lore')?.trailers['Lore-id']?.[0]).toBe('aaaa1111');
    });

    it('should match scope case-insensitively', async () => {
      const commit = makeLoreCommit({ subject: 'feat(Auth): add login', id: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[commit.hash, []]]));

      const result = await repo.findAll({ ...makeQueryOptions(), scope: 'auth' });

      expect(result).toHaveLength(1);
    });

    it('should return empty array when no scope matches', async () => {
      const commit = makeLoreCommit({ subject: 'feat(auth): add login', id: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[commit.hash, []]]));

      const result = await repo.findAll({ ...makeQueryOptions(), scope: 'payments' });

      expect(result).toEqual([]);
    });

    it('should handle commits without scope in subject', async () => {
      const commit = makeLoreCommit({ subject: 'fix: typo', id: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[commit.hash, []]]));

      const result = await repo.findAll({ ...makeQueryOptions(), scope: 'auth' });

      expect(result).toEqual([]);
    });

    it('should append path scope when isScoped=true', async () => {
      const scopedRepo = new AtomRepository(gitClient, trailerParser as any, protocol, protocolRegistry, searchFilter, atomCache, queryCache, true);
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await scopedRepo.findByScope('auth', makeQueryOptions());

      expect(gitClient.log).toHaveBeenCalledWith(
        expect.arrayContaining(['--', '.']),
      );
    });
  });

  describe('resolveFollowLinks', () => {
    it('should resolve atoms referenced by Related trailers', async () => {
      const commit1 = makeLoreCommit({ hash: 'aaa', id: 'aaaa1111', trailerExtras: 'Related: bbbb2222' });
      const commit2 = makeLoreCommit({ hash: 'bbb', id: 'bbbb2222' });

      // First call for initial atoms, second call for findById
      vi.mocked(gitClient.log).mockResolvedValue([commit1, commit2]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['aaa', []], ['bbb', []]]));

      // Create initial atoms manually with new structure
      const initialAtoms = [{
        id: 'aaaa1111',
        commitHash: 'aaa',
        date: new Date('2025-01-15T10:00:00Z'),
        author: 'dev@example.com',
        intent: 'feat(auth): add login',
        body: '',
        protocols: new Map([
          ['lore', {
            name: 'Lore',
            version: '1.0',
            identityKey: LORE_ID_KEY,
            trailers: {
              [LORE_ID_KEY]: ['aaaa1111'],
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
              Related: ['bbbb2222'],
            }
          }]
        ]),
        filesChanged: [],
      }] as any;

      const result = await repo.resolveFollowLinks(initialAtoms, 2);

      expect(result).toHaveLength(2);
      const ids = result.map((a) => a.protocols.get('lore')?.trailers['Lore-id']?.[0]);
      expect(ids).toContain('aaaa1111');
      expect(ids).toContain('bbbb2222');
    });

    it('should return original atoms when maxDepth is 0', async () => {
      const atoms = [{
        id: 'aaaa1111',
        commitHash: 'aaa',
        date: new Date(),
        author: 'dev@example.com',
        intent: 'test',
        body: '',
        protocols: new Map([
          ['lore', {
            name: 'Lore',
            version: '1.0',
            identityKey: LORE_ID_KEY,
            trailers: {
              [LORE_ID_KEY]: ['aaaa1111'],
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
              Related: ['bbbb2222'],
            }
          }]
        ]),
        filesChanged: [],
      }] as any;

      const result = await repo.resolveFollowLinks(atoms, 0);

      expect(result).toHaveLength(1);
      expect(result[0].protocols.get('lore')?.trailers['Lore-id']?.[0]).toBe('aaaa1111');
    });

    it('should return original atoms when no follow links exist', async () => {
      const atoms = [{
        id: 'aaaa1111',
        commitHash: 'aaa',
        date: new Date(),
        author: 'dev@example.com',
        intent: 'test',
        body: '',
        protocols: new Map([
          ['lore', {
            name: 'Lore',
            version: '1.0',
            identityKey: LORE_ID_KEY,
            trailers: {
              [LORE_ID_KEY]: ['aaaa1111'],
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
            }
          }]
        ]),
        filesChanged: [],
      }] as any;

      const result = await repo.resolveFollowLinks(atoms, 3);

      expect(result).toHaveLength(1);
    });

    it('should handle circular references without infinite loop', async () => {
      // Atom A references B, Atom B references A
      const commitA = makeLoreCommit({ hash: 'aaa', id: 'aaaa1111', trailerExtras: 'Related: bbbb2222' });
      const commitB = makeLoreCommit({ hash: 'bbb', id: 'bbbb2222', trailerExtras: 'Related: aaaa1111' });

      vi.mocked(gitClient.log).mockResolvedValue([commitA, commitB]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['aaa', []], ['bbb', []]]));

      const atomA = {
        id: 'aaaa1111',
        commitHash: 'aaa',
        date: new Date(),
        author: 'dev@example.com',
        intent: 'test',
        body: '',
        protocols: new Map([
          ['lore', {
            name: 'Lore',
            version: '1.0',
            identityKey: LORE_ID_KEY,
            trailers: {
              [LORE_ID_KEY]: ['aaaa1111'],
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
              Related: ['bbbb2222'],
            }
          }]
        ]),
        filesChanged: [],
      } as any;

      const result = await repo.resolveFollowLinks([atomA], 5);

      expect(result).toHaveLength(2);
    });

    it('should not exceed maxDepth in transitive resolution', async () => {
      // Chain: A -> B -> C -> D, but maxDepth = 1
      const commitB = makeLoreCommit({ hash: 'bbb', id: 'bbbb2222', trailerExtras: 'Related: cccc3333' });
      const commitC = makeLoreCommit({ hash: 'ccc', id: 'cccc3333', trailerExtras: 'Related: dddd4444' });
      const commitD = makeLoreCommit({ hash: 'ddd', id: 'dddd4444' });

      // findById will search all commits
      vi.mocked(gitClient.log).mockResolvedValue([commitB, commitC, commitD]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['bbb', []], ['ccc', []], ['ddd', []]]));

      const atomA = {
        id: 'aaaa1111',
        commitHash: 'aaa',
        date: new Date(),
        author: 'dev@example.com',
        intent: 'test',
        body: '',
        protocols: new Map([
          ['lore', {
            name: 'Lore',
            version: '1.0',
            identityKey: LORE_ID_KEY,
            trailers: {
              [LORE_ID_KEY]: ['aaaa1111'],
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
              Related: ['bbbb2222'],
            }
          }]
        ]),
        filesChanged: [],
      } as any;

      const result = await repo.resolveFollowLinks([atomA], 1);

      // Should find A and B only (depth 1), not C or D
      expect(result).toHaveLength(2);
      const ids = result.map((a) => a.protocols.get('lore')?.trailers['Lore-id']?.[0]);
      expect(ids).toContain('aaaa1111');
      expect(ids).toContain('bbbb2222');
    });

    it('should return empty array for empty input', async () => {
      const result = await repo.resolveFollowLinks([], 3);
      expect(result).toEqual([]);
    });
  });

  describe('git log format', () => {
    it('should pass args to git client log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await repo.findAll();

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(Array.isArray(logArgs)).toBe(true);
    });

    it('should pass pre-resolved git log args including -- separator to git client', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const gitLogArgs = ['--', 'src/auth.ts'];
      await repo.findByTarget(gitLogArgs, makeQueryOptions());

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--');
      expect(logArgs).toContain('src/auth.ts');
    });
  });

  describe('batching behavior', () => {
    it('should call getFilesChanged only for Lore commits, not non-Lore commits', async () => {
      const loreCommit = makeLoreCommit({ hash: 'abc12345', id: 'aaaa1111' });
      const nonLoreCommit: RawCommit = {
        hash: 'non-lore',
        date: '2025-01-16T10:00:00Z',
        author: 'dev@example.com',
        subject: 'chore: deps',
        body: '',
        trailers: '',
      };
      vi.mocked(gitClient.log).mockResolvedValue([loreCommit, nonLoreCommit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['abc12345', ['src/auth.ts']]]));

      await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(gitClient.getFilesChanged).toHaveBeenCalledWith(['abc12345']);
    });

    it('should handle many commits in a single batch', async () => {
      const commits = Array.from({ length: 25 }, (_, i) =>
        makeLoreCommit({ hash: `hash${i}`, id: `${String(i).padStart(8, '0')}` }),
      );
      vi.mocked(gitClient.log).mockResolvedValue(commits);
      
      const filesMap = new Map<string, string[]>();
      commits.forEach(c => filesMap.set(c.hash, ['file.ts']));
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(filesMap);

      const result = await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(result).toHaveLength(25);
      expect(gitClient.getFilesChanged).toHaveBeenCalledTimes(2);
      expect(vi.mocked(gitClient.getFilesChanged).mock.calls[0][0]).toHaveLength(20);
      expect(vi.mocked(gitClient.getFilesChanged).mock.calls[1][0]).toHaveLength(5);

    });

    it('should propagate getFilesChanged errors', async () => {
      const commit = makeLoreCommit({ id: 'deadbeef' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockRejectedValue(new Error('git failed'));

      await expect(repo.findByTarget(makeGitLogArgs(), makeQueryOptions())).rejects.toThrow('git failed');
    });
  });

  describe('Multi-Protocol Hydration', () => {
    it('should hydrate an atom with multiple protocol states if claimed by multiple protocols', async () => {
      // 1. Create a second protocol (Fred) using a manual mock to avoid Protocol class getter issues
      const fredProtocol: any = {getAllKeys: () => ['Fred-id', 'Confidence'], 
        name: 'Fred',
        version: '1.0',
        identityKey: 'Fred-id',
        getIdentity: (trailers: any) => trailers['Fred-id']?.[0] || null,
        namespace: '',
        isPermissive: false,
        claims: (raw: string) => raw.includes('Fred-id:'),
        owns: (key: string) => key.toLowerCase() === 'fred-id',
        authorize: (key: string) => key.toLowerCase() === 'fred-id' ? 'Fred-id' : (key.toLowerCase() === 'confidence' ? 'Confidence' : null),
        getDefinition: (key: string) => null,
        isValidIdentity: (id: string) => true,
        getDiscoveryGrep: () => [],
        getDiscoveryPattern: () => '^Fred-id: [0-9a-f]{8}',
        getSearchGrep: () => [],
        matches: () => true,
        parse: (raw: string) => ({getAllKeys: () => ['Fred-id', 'Confidence'], 
          name: 'Fred',
          version: '1.0',
          identityKey: 'Fred-id',
        getIdentity: (trailers: any) => trailers['Fred-id']?.[0] || null,
          trailers: { 'Fred-id': ['fred5678'], 'Confidence': ['high'] }
        }),
        getAllKeys: () => ['Fred-id', 'Confidence'], getAuthorizedKeys: () => ['Fred-id', 'Confidence'],
        getScalarKeys: () => ['Fred-id', 'Confidence'],
        getListKeys: () => [],
        getReferenceKeys: () => [],
        isCore: () => false,
        getUiKind: () => 'custom',
        getUiColor: () => 'cyan',
        getFormattableDefinitions: () => ({}),
      } as any;

      protocolRegistry.register(fredProtocol);

      // 2. Mock a commit containing BOTH Lore and Fred trailers
      const trailers = `${LORE_ID_KEY}: lore1234\nFred-id: fred5678\nConfidence: high`;
      const commit: RawCommit = {
        hash: 'multi-hash',
        date: new Date().toISOString(),
        author: 'cole@example.com',
        subject: 'feat: multi-protocol',
        body: 'Body',
        trailers,
      };

      vi.mocked(gitClient.log).mockResolvedValue([commit]);

      // 3. Find all atoms
      const atoms = await repo.findAll();

      // 4. Verify hydration
      expect(atoms).toHaveLength(1);
      const atom = atoms[0];
      
      expect(atom.protocols.has('lore')).toBe(true);
      expect(atom.protocols.has('fred')).toBe(true);

      const loreState = atom.protocols.get('lore')!;
      expect(loreState.trailers[LORE_ID_KEY]).toEqual(['lore1234']);
      expect(loreState.trailers.Confidence).toEqual(['high']);

      const fredState = atom.protocols.get('fred')!;
      expect(fredState.trailers['Fred-id']).toEqual(['fred5678']);
    });

    it('should respect implicit ownership (protocols get what they define, permissive gets orphans)', async () => {
      // 1. Lore is permissive (greedy)
      const loreProtocol = protocolRegistry.get('lore')!;
      vi.spyOn(loreProtocol, 'isPermissive', 'get').mockReturnValue(true);

      // 2. Fred is strict but defines its own ID
      const fredProtocol: any = {getAllKeys: () => ['Fred-id', 'Confidence'], 
        name: 'Fred',
        version: '1.0',
        identityKey: 'Fred-id',
        getIdentity: (trailers: any) => trailers['Fred-id']?.[0] || null,
        namespace: '',
        isPermissive: false,
        claims: (raw: string) => raw.includes('Fred-id:'),
        owns: (key: string) => key.toLowerCase() === 'fred-id' || key.toLowerCase() === 'confidence',
        authorize: (key: string) => key.toLowerCase() === 'fred-id' ? 'Fred-id' : (key.toLowerCase() === 'confidence' ? 'Confidence' : null),
        isValidIdentity: (id: string) => true,
        getDiscoveryGrep: () => [],
        getDiscoveryPattern: () => '^Fred-id: [0-9a-f]{8}',
        getSearchGrep: () => [],
        matches: () => true,
        parse: (raw: string, unclaimedKeys?: Set<string>) => {
          const trailers: Record<string, string[]> = {};
          if (raw.includes('Fred-id: 123')) trailers['Fred-id'] = ['123'];
          if (raw.includes('Confidence: high')) trailers['Confidence'] = ['high'];
          return {getAllKeys: () => ['Fred-id', 'Confidence'],  name: 'Fred', version: '1.0', identityKey: 'Fred-id', trailers };
        },
      } as any;
      
      protocolRegistry.register(fredProtocol);

      // 3. Mock commit: 
      // - Lore-id (Owned by Lore)
      // - Fred-id (Owned by Fred)
      // - Confidence (Owned by BOTH)
      // - Adhoc (Owned by NEITHER)
      const trailers = `Lore-id: lore123\nFred-id: 123\nConfidence: high\nAdhoc: value`;
      const commit: RawCommit = {
        hash: 'implicit-hash',
        date: new Date().toISOString(),
        author: 'cole@example.com',
        subject: 'feat: implicit claims',
        body: 'Body',
        trailers,
      };

      vi.mocked(gitClient.log).mockResolvedValue([commit]);

      const atoms = await repo.findAll();
      const atom = atoms[0];

      const fredState = atom.protocols.get('fred')!;
      const loreState = atom.protocols.get('lore')!;

      // Fred gets what it defines
      expect(fredState.trailers['Fred-id']).toEqual(['123']);
      expect(fredState.trailers['Confidence']).toEqual(['high']);
      expect(fredState.trailers['Adhoc']).toBeUndefined(); // Fred is not permissive
      
      // Lore gets what it defines
      expect(loreState.trailers['Lore-id']).toEqual(['lore123']);
      expect(loreState.trailers['Confidence']).toEqual(['high']);
      
      // Lore is permissive so it gets the orphan
      expect(loreState.trailers['Adhoc']).toEqual(['value']);
      
      // IMPORTANT: Lore should NOT get Fred-id because Fred defined/owned it!
      expect(loreState.trailers['Fred-id']).toBeUndefined();
    });

    it('should find an atom by ID across multiple protocols', async () => {
      // 1. Create and register Fred protocol
      const fredProtocol: any = {getAllKeys: () => ['Fred-id', 'Confidence'], 
        name: 'Fred',
        version: '1.0',
        identityKey: 'Fred-id',
        getIdentity: (trailers: any) => trailers['Fred-id']?.[0] || null,
        namespace: '',
        isPermissive: false,
        claims: (raw: string) => raw.includes('Fred-id:'),
        owns: (key: string) => key.toLowerCase() === 'fred-id',
        authorize: (key: string) => key.toLowerCase() === 'fred-id' ? 'Fred-id' : null,
        isValidIdentity: (id: string) => /^[0-9a-f]{8}$/.test(id),
        getDiscoveryGrep: () => [],
        getDiscoveryPattern: () => '^Fred-id: [0-9a-f]{8}',
        getIdentityPattern: (id: string) => `^Fred-id: ${id}`,
        matches: () => true,
        parse: (raw: string) => ({getAllKeys: () => ['Fred-id', 'Confidence'], 
          name: 'Fred',
          version: '1.0',
          identityKey: 'Fred-id',
        getIdentity: (trailers: any) => trailers['Fred-id']?.[0] || null,
          trailers: { 'Fred-id': ['f8ed5678'] }
        }),
      } as any;
      
      protocolRegistry.register(fredProtocol);

      // 2. Mock Git log to return a Lore commit when searching for a Fred ID (simulation of OR grep)
      const commit = makeLoreCommit({ id: 'lore1234' });
      // Actually we want the Fred commit to be found
      const fredCommit: RawCommit = {
        hash: 'fred-hash',
        date: new Date().toISOString(),
        author: 'cole@example.com',
        subject: 'feat: fred',
        body: '',
        trailers: 'Fred-id: f8ed5678',
      };

      vi.mocked(gitClient.log).mockResolvedValue([fredCommit]);

      // 3. Find by Fred ID
      const result = await repo.findById('f8ed5678');

      // 4. Verify
      expect(result).not.toBeNull();
      expect(result!.protocols.has('fred')).toBe(true);
      const state = result!.protocols.get('fred')!;
      expect(state.trailers['Fred-id']).toEqual(['f8ed5678']);
    });
  });

  describe('Discovery Pass Precision', () => {
    it('should generate targeted greps for the "has" filter based on schema ownership', async () => {
      // 1. Lore owns 'Constraint' (core)
      // 2. Fred (namespaced) does NOT own 'Constraint'
      const fredProtocol: any = {getAllKeys: () => ['Fred-id', 'Confidence'], 
        name: 'Fred',
        version: '1.0',
        identityKey: 'Fred-id',
        getIdentity: (trailers: any) => trailers['Fred-id']?.[0] || null,
        namespace: 'Fred',
        isPermissive: false,
        claims: () => true,
        owns: (key: string) => key.toLowerCase() === 'fred-id', // Does NOT own Constraint
        authorize: (key: string) => key.toLowerCase() === 'fred-id' ? 'Fred-id' : null,
        isValidIdentity: () => true,
        getDiscoveryGrep: () => [],
        getDiscoveryPattern: () => '^Fred/Fred-id: [0-9a-f]{8}',
        getSearchGrep: () => [],
        matches: () => true,
        parse: () => ({getAllKeys: () => ['Fred-id', 'Confidence'],  name: 'Fred', version: '1.0', identityKey: 'Fred-id', trailers: {} }),
      } as any;
      
      protocolRegistry.register(fredProtocol);
      vi.mocked(gitClient.log).mockResolvedValue([]);

      // 3. Search for atoms with 'Constraint'
      await repo.findAll({ has: 'Constraint' });

      // 4. Verify generated args
      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      
      // Should include Lore's constraint grep (root namespace)
      // Lore is registered in beforeEach, it owns 'Constraint'
      expect(logArgs.some(a => a.includes('^Constraint: '))).toBe(true);
      
      // Should NOT include a Fred/Constraint grep because Fred doesn't own it
      expect(logArgs.some(a => a.includes('^Fred/Constraint: '))).toBe(false);
    });
  });
});
