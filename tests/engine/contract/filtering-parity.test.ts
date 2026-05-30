import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { SearchFilter } from '../../../src/engine/services/search-filter.js';
import { PathResolver } from '../../../src/engine/services/path-resolver.js';
import type { IGitClient, RawCommit } from '../../../src/engine/interfaces/git-client.js';
import type { SearchOptions } from '../../../src/engine/types/query.js';
import { TEST_PROTOCOL_DEFINITION, makeProtocol, makeAtomRepository } from '../engine-test-utils.js';

const TEST_ID_KEY = "Mock-id";

describe('AtomRepository Filtering Parity', () => {
  let gitClient: IGitClient;
  let repo: any;
  let protocol: Protocol;
  let protocolRegistry: ProtocolRegistry;

  beforeEach(() => {
    gitClient = {
      log: vi.fn(async () => []),
      getCommitsByHashes: vi.fn(async (hashes) => []),
      getFilesChanged: vi.fn(async (hashes: string[]) => {
        const map = new Map<string, string[]>();
        hashes.forEach(h => map.set(h, ['src/main.ts']));
        return map;
      }),
      resolveDate: vi.fn(async (d: string) => {
        const date = new Date(d);
        return isNaN(date.getTime()) ? null : date;
      }),
      resolveRef: vi.fn(async () => 'head-hash'),
    } as any;

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
    it('should always include Atom Discovery Mode flags (Mock-id sentinel)', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      await repo.find();
      
      const args = vi.mocked(gitClient.log).mock.calls[0][0];

      expect(args.some(a => a.startsWith('--grep=') && a.includes(TEST_ID_KEY))).toBe(true);
      expect(args).toContain('--extended-regexp');
      expect(args).toContain('--regexp-ignore-case');
      expect(args).toContain('--all-match');
    });

    it('should generate correct Git flags for author and scope with Discovery Mode', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const options: SearchOptions = {
        author: 'alice',
        scope: 'auth',
      };
      await repo.find(options);
      
      const args = vi.mocked(gitClient.log).mock.calls[0][0];

      expect(args).toContain('--author=alice');
      expect(args).toContain('--grep=^[a-zA-Z]+\\(auth\\):');
      expect(args).toContain('--extended-regexp');
    });

    it('should generate correct Git flags for the "has" trailer filter', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const options: SearchOptions = {
        has: 'Constraint',
      };
      await repo.find(options);
      
      const args = vi.mocked(gitClient.log).mock.calls[0][0];

      // should contain the discovery pattern for Constraint
      expect(args.some(a => a.startsWith('--grep=') && a.includes('Constraint: '))).toBe(true);
      expect(args).toContain('--all-match');
    });

    it('should generate correct Git flags for Enum filters (pushdown)', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const options: SearchOptions = {
        filters: {
          Confidence: 'high'
        }
      };
      await repo.find(options);
      
      const args = vi.mocked(gitClient.log).mock.calls[0][0];

      expect(args.some(a => a.startsWith('--grep=') && a.includes('Confidence: high'))).toBe(true);
      expect(args).toContain('--all-match');
    });

    it('should generate correct Git flags for full-text search (pushdown)', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const options: SearchOptions = {
        text: 'encryption'
      };
      await repo.find(options);
      
      const args = vi.mocked(gitClient.log).mock.calls[0][0];

      expect(args).toContain('--grep=encryption');
    });

    it('should escape regex special characters in scope and id (Security)', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const options: SearchOptions = {
        scope: 'auth.v1',
      };
      await repo.find(options);
      
      const args = vi.mocked(gitClient.log).mock.calls[0][0];
      // Dot should be escaped
      expect(args).toContain('--grep=^[a-zA-Z]+\\(auth\\.v1\\):');
    });
  });

  describe('Refinement Phase (Fine Filtering)', () => {
    it('should correctly narrow results even if Git produces false positives', async () => {
      // Simulation: Git returns two commits, but only one truly matches the author filter
      const c1: RawCommit = { hash: 'h1', date: new Date().toISOString(), author: 'alice@ex.com', trailers: `${TEST_ID_KEY}: 1`, subject: 's', body: 'b' };
      const c2: RawCommit = { hash: 'h2', date: new Date().toISOString(), author: 'bob@ex.com', trailers: `${TEST_ID_KEY}: 2`, subject: 's', body: 'b' };
      
      vi.mocked(gitClient.log).mockResolvedValue([c1, c2]);
      
      const options: SearchOptions = { author: 'alice' };
      const atoms = await repo.find(options);

      expect(atoms).toHaveLength(1);
      expect(atoms[0].author).toBe('alice@ex.com');
    });

    it('should correctly refine results for Enums and Has', async () => {
      const c1: RawCommit = { hash: 'h1', date: new Date().toISOString(), author: 'a', trailers: `${TEST_ID_KEY}: 1\nConfidence: high`, subject: 's', body: 'b' };
      const c2: RawCommit = { hash: 'h2', date: new Date().toISOString(), author: 'a', trailers: `${TEST_ID_KEY}: 2\nConfidence: low`, subject: 's', body: 'b' };
      
      vi.mocked(gitClient.log).mockResolvedValue([c1, c2]);

      const options: SearchOptions = { filters: { Confidence: 'high' } };
      const atoms = await repo.find(options);

      expect(atoms).toHaveLength(1);
      expect(atoms[0].protocols.get('mock')?.trailers.Confidence).toEqual(['high']);
    });

    it('should correctly refine results for full-text search', async () => {
      const c1: RawCommit = { hash: 'h1', date: new Date().toISOString(), author: 'a', trailers: `${TEST_ID_KEY}: 1`, subject: 'fix encryption', body: 'b' };
      const c2: RawCommit = { hash: 'h2', date: new Date().toISOString(), author: 'a', trailers: `${TEST_ID_KEY}: 2`, subject: 'fix bug', body: 'b' };
      
      vi.mocked(gitClient.log).mockResolvedValue([c1, c2]);

      const options: SearchOptions = { text: 'encryption' };
      const atoms = await repo.find(options);

      expect(atoms).toHaveLength(1);
      expect(atoms[0].subject).toBe('fix encryption');
    });
  });

  describe('Integration of Filters', () => {
    it('behaves as an AND operation across different filter types', async () => {
      const c1: RawCommit = { hash: 'h1', author: 'alice', trailers: `${TEST_ID_KEY}: 1\nConfidence: high`, subject: 's', body: 'b', date: new Date().toISOString() };
      const c2: RawCommit = { hash: 'h2', author: 'alice', trailers: `${TEST_ID_KEY}: 2\nConfidence: low`, subject: 's', body: 'b', date: new Date().toISOString() };
      const c3: RawCommit = { hash: 'h3', author: 'bob', trailers: `${TEST_ID_KEY}: 3\nConfidence: high`, subject: 's', body: 'b', date: new Date().toISOString() };

      vi.mocked(gitClient.log).mockResolvedValue([c1, c2, c3]);

      const options: SearchOptions = { 
        author: 'alice',
        filters: { Confidence: 'high' }
      };
      
      const atoms = await repo.find(options);
      expect(atoms).toHaveLength(1);
      expect(atoms[0].commitHash).toBe('h1');
    });
  });
});
