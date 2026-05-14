import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../src/services/atom-repository.js';
import { TrailerParser } from '../../../src/services/trailer-parser.js';
import type { IGitClient, RawCommit } from '../../../src/interfaces/git-client.js';
import type { PathQueryOptions } from '../../../src/types/query.js';

describe('AtomRepository Filtering Parity', () => {
  let gitClient: IGitClient;
  let trailerParser: TrailerParser;
  let repo: AtomRepository;

  const mockAtoms: RawCommit[] = [
    {
      hash: 'hash1',
      date: '2026-05-01T12:00:00Z',
      author: 'cole@example.com',
      subject: 'feat(auth): valid login',
      body: 'Body text here',
      trailers: 'Lore-id: abc12345\nConfidence: high',
    },
    {
      hash: 'hash2',
      date: '2026-05-02T12:00:00Z',
      author: 'ivan@example.com',
      subject: 'fix(ui): layout bug',
      body: 'Body text here',
      trailers: 'Lore-id: def67890\nConfidence: low',
    },
    {
      hash: 'hash3',
      date: '2026-05-03T12:00:00Z',
      author: 'cole@example.com',
      subject: 'feat(api): endpoint',
      body: 'Search for "login" here but not in subject',
      trailers: 'Lore-id: 01234567\nConfidence: medium',
    },
    {
      hash: 'hash4',
      date: '2026-05-04T12:00:00Z',
      author: 'other@example.com',
      subject: 'chore: no lore here',
      body: 'just text',
      trailers: '', // Missing Lore-id
    },
    {
      hash: 'hash5',
      date: '2026-05-05T12:00:00Z',
      author: 'false-positive-login@example.com',
      subject: 'feat(api): false positive',
      body: 'No match here',
      trailers: 'Lore-id: fedcba98\nConfidence: high\nConstraint: This commit matches in email only',
    },
  ];

  beforeEach(() => {
    gitClient = {
      log: vi.fn(),
      resolveRef: vi.fn().mockResolvedValue('head-hash'),
      getFilesChanged: vi.fn().mockResolvedValue(['src/file.ts']),
      getCommitsByHashes: vi.fn(),
    } as any;

    trailerParser = new TrailerParser();

    repo = new AtomRepository(
      gitClient,
      trailerParser,
    );
  });

  describe('Discovery Phase (Git Coarse Filtering)', () => {
    it('should always include Atom Discovery Mode flags (Lore-id sentinel)', async () => {
      const options = (repo as any).makeDefaultOptions();
      const args = (repo as any).buildLogArgs(options);

      expect(args).toContain('--grep=Lore-id: [0-9a-f]{8}');
      expect(args).toContain('--extended-regexp');
      expect(args).toContain('--regexp-ignore-case');
      expect(args).toContain('--all-match');
    });

    it('should generate correct Git flags for author and scope with Discovery Mode', async () => {
      const options: Partial<PathQueryOptions> = {
        author: 'cole',
        scope: 'auth',
      };

      // Access private buildLogArgs for inspection
      const args = (repo as any).buildLogArgs((repo as any).makeDefaultOptions(options));

      expect(args).toContain('--author=cole');
      expect(args).toContain('--regexp-ignore-case');
      expect(args).toContain('--all-match');
      // Scope regex check
      expect(args).toContain('--grep=^[a-zA-Z]+\\(auth\\)');
      expect(args).toContain('--extended-regexp');
    });
  });

  describe('Refinement Phase (Lore Fine Filtering)', () => {
    it('should correctly narrow results even if Git produces false positives', async () => {
      // Simulate Git returning everything (no coarse filtering)
      vi.mocked(gitClient.log).mockResolvedValue(mockAtoms);

      const options: Partial<PathQueryOptions> = {
        author: 'cole',
        scope: 'auth',
      };

      const result = await repo.findAll(options);

      // Should only find hash1
      // hash2: different author, different scope
      // hash3: same author, different scope
      // hash5: different author, different scope
      expect(result).toHaveLength(1);
      expect(result[0].commitHash).toBe('hash1');
    });
  });

  describe('Integration of Filters', () => {
    it('behaves as an AND operation across different filter types', async () => {
      vi.mocked(gitClient.log).mockResolvedValue(mockAtoms);

      const options: Partial<PathQueryOptions> = {
        author: 'cole',
        scope: 'api',
      };

      const result = await repo.findAll(options);

      // Only hash3 matches both
      expect(result).toHaveLength(1);
      expect(result[0].commitHash).toBe('hash3');
    });
  });
});
