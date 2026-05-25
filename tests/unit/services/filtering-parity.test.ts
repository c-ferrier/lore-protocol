import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { TrailerParser } from '../../../src/engine/services/trailer-parser.js';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';
import { SearchFilter } from '../../../src/engine/services/search-filter.js';
import { NullAtomCache } from '../../../src/engine/services/atom-cache.js';
import { NullQueryCache } from '../../../src/engine/services/query-cache.js';
import type { IGitClient, RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { LORE_DEFAULT_CONFIG } from '../../../src/lore/defaults.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { escapeRegex } from '../../../src/util/regex.js';

describe('AtomRepository Filtering Parity', () => {
  let gitClient: IGitClient;
  let trailerParser: TrailerParser;
  let repo: AtomRepository;
  let protocolRegistry: ProtocolRegistry;
  let searchFilter: SearchFilter;
  let protocol: Protocol;

  const mockAtoms: RawCommit[] = [
    {
      hash: 'hash1',
      date: '2026-05-01T12:00:00Z',
      author: 'cole@example.com',
      subject: 'feat(auth): valid login',
      body: 'Body text here',
      trailers: 'Lore-id: abc12345\nConfidence: high\nConstraint: c1',
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
      getFilesChanged: vi.fn(async (hashes: string[]) => {
        const map = new Map<string, string[]>();
        hashes.forEach(h => map.set(h, ['src/main.ts']));
        return map;
      }),
      resolveDate: vi.fn(async (d: string) => new Date(d)),
      resolveRef: vi.fn(async () => 'head-hash'),
    } as any;

    protocol = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);
    protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(protocol);
    trailerParser = new TrailerParser();
    searchFilter = new SearchFilter(protocolRegistry);
    const atomCache = new NullAtomCache();
    const queryCache = new NullQueryCache();
    repo = new AtomRepository(gitClient, trailerParser, protocol, protocolRegistry, searchFilter, atomCache, queryCache);
  });

  describe('Discovery Phase (Git Coarse Filtering)', () => {
    it('should always include Atom Discovery Mode flags (Lore-id sentinel)', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      await repo.findAll();
      
      const args = vi.mocked(gitClient.log).mock.calls[0][0];

      // Now consolidated into a single OR statement
      expect(args.some(a => a.startsWith('--grep=') && a.includes('Lore-id'))).toBe(true);
      expect(args).toContain('--extended-regexp');
      expect(args).toContain('--regexp-ignore-case');
      expect(args).toContain('--all-match');
    });

    it('should generate correct Git flags for author and scope with Discovery Mode', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const options = {
        author: 'cole',
        scope: 'auth',
      };

      await repo.findAll(options);
      const args = vi.mocked(gitClient.log).mock.calls[0][0];

      expect(args).toContain('--author=cole');
      expect(args).toContain('--regexp-ignore-case');
      expect(args).toContain('--all-match');
      // Scope regex check
      expect(args).toContain('--grep=^[a-zA-Z]+\\(auth\\):');
      expect(args).toContain('--extended-regexp');
    });

    it('should generate correct Git flags for the "has" trailer filter', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      await repo.findAll({ has: 'Constraint' });
      
      const args = vi.mocked(gitClient.log).mock.calls[0][0];
      // Expect parenthesized pattern for the 'has' filter due to multi-protocol support
      expect(args.some(a => a.startsWith('--grep=') && a.includes('(^Constraint: )'))).toBe(true);
    });

    it('should generate correct Git flags for Enum filters (pushdown)', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      await repo.findAll({
        filters: {
          confidence: 'high',
          'Scope-risk': 'narrow',
          Reversibility: 'clean',
        }
      } as any);
      
      const args = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(args).toContain('--grep=^Confidence: high');
      expect(args).toContain('--grep=^Scope-risk: narrow');
      expect(args).toContain('--grep=^Reversibility: clean');
    });

    it('should generate correct Git flags for full-text search (pushdown)', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      await repo.findAll({ text: 'login logic' });
      
      const args = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(args).toContain('--grep=login logic');
    });

    it('should escape regex special characters in scope and id (Security)', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      
      // Test scope escaping
      const targetScope = 'auth)';
      await repo.findAll({ scope: targetScope });
      let args = vi.mocked(gitClient.log).mock.calls[0][0];
      const escapedScope = escapeRegex(targetScope);
      expect(args).toContain(`--grep=^[a-zA-Z]+\\(${escapedScope}\\):`);

      // Test id escaping
      // Mock validation to allow special chars for escaping test
      vi.spyOn(protocol, 'isValidIdentity').mockReturnValue(true);
      const targetId = 'abc-123*';
      await repo.findById(targetId);
      args = vi.mocked(gitClient.log).mock.calls[1][0];
      const escapedId = escapeRegex(targetId);
      expect(args).toContain(`--grep=^Lore-id: ${escapedId}`);
    });
  });

  describe('Refinement Phase (Lore Fine Filtering)', () => {
    it('should correctly narrow results even if Git produces false positives', async () => {
      // Mock git returning all, but refinement should filter
      vi.mocked(gitClient.log).mockResolvedValue(mockAtoms);
      
      const options = { author: 'cole@example.com' };
      const results = await repo.findAll(options);
      
      expect(results).toHaveLength(2); // hash1 and hash3
      expect(results.every(a => a.author === 'cole@example.com')).toBe(true);
    });

    it('should correctly refine results for Enums and Has', async () => {
      vi.mocked(gitClient.log).mockResolvedValue(mockAtoms);
      
      // Only hash1 and hash5 are high confidence
      const resultConf = await repo.findAll({ filters: { confidence: 'high' } } as any);
      expect(resultConf).toHaveLength(2); // hash1 and hash5
      
      const resultConstraint = await repo.findAll({ has: 'Constraint' });
      expect(resultConstraint).toHaveLength(2); // hash1 and hash5
    });

    it('should correctly refine results for full-text search', async () => {
      vi.mocked(gitClient.log).mockResolvedValue(mockAtoms);
      
      // Search for "login"
      // hash1 matches in subject
      // hash3 matches in body
      // hash5 matches in email but email is checked via author filter, NOT text search
      // (Actually text search checks intent, body, and all trailers)
      const results = await repo.findAll({ text: 'login' });
      expect(results).toHaveLength(2); // hash1 and hash3
    });
  });

  describe('Integration of Filters', () => {
    it('behaves as an AND operation across different filter types', async () => {
      vi.mocked(gitClient.log).mockResolvedValue(mockAtoms);
      
      // author=cole AND confidence=high
      const results = await repo.findAll({ 
        author: 'cole', 
        filters: { confidence: 'high' } 
      } as any);
      
      expect(results).toHaveLength(1);
      expect(results[0].commitHash).toBe('hash1');
    });
  });
});
