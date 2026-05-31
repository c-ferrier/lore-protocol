import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { SearchFilter } from '../../../src/engine/services/search-filter.js';
import { PathResolver } from '../../../src/engine/services/path-resolver.js';
import type { IGitClient, RawCommit } from '../../../src/engine/interfaces/git-client.js';
import type { SearchOptions } from '../../../src/engine/types/query.js';
import { TEST_PROTOCOL_DEFINITION, makeAtomRepository, makeProtocol, makeMockGitClient } from '../engine-test-utils.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { Protocol } from '../../../src/engine/services/protocol.js';

const TEST_ID_KEY = "Mock-id";

describe('AtomRepository Filtering Parity', () => {
  let gitClient: any;
  let repo: AtomRepository;
  let protocol: Protocol;
  let protocolRegistry: ProtocolRegistry;

  beforeEach(() => {
    gitClient = makeMockGitClient();

    protocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
    protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(protocol);

    repo = makeAtomRepository({
        gitClient,
        registry: protocolRegistry,
        pathResolver: new PathResolver('/mock', '/mock'),
        searchFilter: new SearchFilter(protocolRegistry)
    });
  });

  describe('Discovery Phase (Git Coarse Filtering)', () => {
    it('should always include Atom Discovery Mode patterns (Mock-id sentinel)', async () => {
      await repo.find();
      
      const query = vi.mocked(gitClient.query).mock.calls[0][0];

      // Top level is list of lists
      expect(query.regexPatterns[0].some((p: string) => p.includes(TEST_ID_KEY))).toBe(true);
    });

    it('should generate correct StorageQuery for author and scope', async () => {
      const options: SearchOptions = {
        author: 'alice',
        scope: 'auth',
      };
      await repo.find(options);
      
      const query = vi.mocked(gitClient.query).mock.calls[0][0];

      expect(query.author).toBe('alice');
      // Scope should be its own AND condition
      expect(query.regexPatterns.some((set: string[]) => set.some(p => p.includes('^[a-zA-Z]+\\(auth\\):')))).toBe(true);
    });

    it('should generate correct StorageQuery for the "has" trailer filter', async () => {
      const options: SearchOptions = {
        has: 'Constraint',
      };
      await repo.find(options);
      
      const query = vi.mocked(gitClient.query).mock.calls[0][0];

      // should contain the discovery pattern for Constraint
      expect(query.regexPatterns.some((set: string[]) => set.some(p => p.includes('Constraint: ')))).toBe(true);
    });

    it('should generate correct StorageQuery for Enum filters (pushdown)', async () => {
      const options: SearchOptions = {
        filters: {
          Confidence: 'high'
        }
      };
      await repo.find(options);
      
      const query = vi.mocked(gitClient.query).mock.calls[0][0];

      expect(query.regexPatterns.some((set: string[]) => set.some(p => p.includes('Confidence: high')))).toBe(true);
    });

    it('should generate correct StorageQuery for full-text search (pushdown)', async () => {
      const options: SearchOptions = {
        text: 'bug fix'
      };
      await repo.find(options);
      
      const query = vi.mocked(gitClient.query).mock.calls[0][0];

      expect(query.regexPatterns.some((set: string[]) => set.includes('bug fix'))).toBe(true);
    });

    it('should escape regex special characters in scope and id (Security)', async () => {
      const options: SearchOptions = {
        scope: 'ui) | grep (secret',
      };
      await repo.find(options);
      
      const query = vi.mocked(gitClient.query).mock.calls[0][0];

      // Characters should be escaped
      expect(query.regexPatterns.some((set: string[]) => set.some(p => p.includes('ui\\) \\| grep \\(secret')))).toBe(true);
    });
  });

  describe('Refinement Phase (Fine Filtering)', () => {
    it('should correctly narrow results even if Git produces false positives', async () => {
      // Mock Git returning two commits, one of which is a false positive
      const commit1: RawCommit = {
        hash: 'h1', date: '2023-01-01', author: 'alice', subject: 'feat: sub', body: 'body',
        trailers: `${TEST_ID_KEY}: aaaaaaaa\nConfidence: high`
      };
      const commit2: RawCommit = {
        hash: 'h2', date: '2023-01-01', author: 'bob', subject: 'feat: sub', body: 'body',
        trailers: `${TEST_ID_KEY}: bbbbbbbb\nConfidence: low`
      };

      vi.mocked(gitClient.query).mockResolvedValue([commit1, commit2]);

      const results = await repo.find({ author: 'alice' });

      expect(results).toHaveLength(1);
      expect(results[0].commitHash).toBe('h1');
    });

    it('should correctly refine results for Enums and Has', async () => {
      const commit1: RawCommit = {
        hash: 'h1', date: '2023-01-01', author: 'a', subject: 's', body: 'b',
        trailers: `${TEST_ID_KEY}: a1\nConfidence: high`
      };
      const commit2: RawCommit = {
        hash: 'h2', date: '2023-01-01', author: 'a', subject: 's', body: 'b',
        trailers: `${TEST_ID_KEY}: a2\nConfidence: low`
      };

      vi.mocked(gitClient.query).mockResolvedValue([commit1, commit2]);

      const results = await repo.find({ filters: { Confidence: 'high' } });

      expect(results).toHaveLength(1);
      expect(results[0].commitHash).toBe('h1');
    });

    it('should correctly refine results for full-text search', async () => {
       const commit1: RawCommit = {
        hash: 'h1', date: '2023-01-01', author: 'a', subject: 'contains needle', body: 'b',
        trailers: `${TEST_ID_KEY}: a1`
      };
      const commit2: RawCommit = {
        hash: 'h2', date: '2023-01-01', author: 'a', subject: 'nothing here', body: 'b',
        trailers: `${TEST_ID_KEY}: a2`
      };

      vi.mocked(gitClient.query).mockResolvedValue([commit1, commit2]);

      const results = await repo.find({ text: 'needle' });

      expect(results).toHaveLength(1);
      expect(results[0].commitHash).toBe('h1');
    });
  });

  describe('Integration of Filters', () => {
    it('behaves as an AND operation across different filter types', async () => {
      const commit1: RawCommit = {
        hash: 'h1', date: '2023-01-01', author: 'alice', subject: 'feat(ui): s', body: 'b',
        trailers: `${TEST_ID_KEY}: a1\nConfidence: high`
      };
      const commit2: RawCommit = {
        hash: 'h2', date: '2023-01-01', author: 'alice', subject: 'feat(auth): s', body: 'b',
        trailers: `${TEST_ID_KEY}: a2\nConfidence: low`
      };

      vi.mocked(gitClient.query).mockResolvedValue([commit1, commit2]);

      // Filter by Alice AND scope auth AND Confidence high
      // commit1: Alice, scope ui, high -> FAIL (scope)
      // commit2: Alice, scope auth, low -> FAIL (confidence)
      const results = await repo.find({ 
        author: 'alice', 
        scope: 'auth',
        filters: { Confidence: 'high' }
      });

      expect(results).toHaveLength(0);
    });
  });
});
