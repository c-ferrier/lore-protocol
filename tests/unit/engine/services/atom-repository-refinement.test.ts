import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../../src/engine/services/atom-repository.js';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { SearchFilter } from '../../../../src/engine/services/search-filter.js';
import { NullAtomCache } from '../../../../src/engine/services/atom-cache.js';
import { NullQueryCache } from '../../../../src/engine/services/query-cache.js';
import type { IGitClient, RawCommit } from '../../../../src/engine/interfaces/git-client.js';
import type { SearchOptions } from '../../../../src/engine/types/query.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG } from '../test-utils.js';

import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';

const MOCK_ID_KEY = "Mock-id";

describe('AtomRepository Refinement', () => {
  let gitClient: IGitClient;
  let trailerParser: TrailerParser;
  let repo: AtomRepository;
  let protocol: Protocol;
  let protocolRegistry: ProtocolRegistry;
  let searchFilter: SearchFilter;

  beforeEach(() => {
    gitClient = {
      log: vi.fn(),
      getFilesChanged: vi.fn().mockImplementation(async (hashes: string[]) => {
        const map = new Map<string, string[]>();
        for (const hash of hashes) map.set(hash, ['file.ts']);
        return map;
      }),
      resolveDate: vi.fn(async (d: string) => new Date(d)),
    } as any;
    protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG);
    protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(protocol);
    trailerParser = new TrailerParser();
    searchFilter = new SearchFilter(protocolRegistry);
    const atomCache = new NullAtomCache();
    const queryCache = new NullQueryCache();
    repo = new AtomRepository(gitClient, trailerParser, protocolRegistry, searchFilter, atomCache, queryCache);
  });

  describe('stripTrailersFromBody (Internal Refinement)', () => {
    it('should remove trailers even with varying whitespace', async () => {
      const trailers = `${MOCK_ID_KEY}: 12345678\nConfidence: high`;
      const raw: RawCommit = {
        hash: 'h1',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: sub',
        body: `Main body text.\n\n   ${MOCK_ID_KEY}: 12345678  \n Confidence: high \n\n`,
        trailers: trailers,
      };
      vi.mocked(gitClient.log).mockResolvedValue([raw]);

      const [atom] = await repo.findAll();
      expect(atom.body).toBe('Main body text.');
    });

    it('should not strip text that looks like a trailer but is in the middle of the body', async () => {
      const trailers = `${MOCK_ID_KEY}: 12345678`;
      const raw: RawCommit = {
        hash: 'h1',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: sub',
        body: `This line looks like a trailer:\nConstraint: must be fast\n\nBut the real one is here.\n\n${MOCK_ID_KEY}: 12345678`,
        trailers: trailers,
      };
      vi.mocked(gitClient.log).mockResolvedValue([raw]);

      const [atom] = await repo.findAll();
      expect(atom.body).toContain('Constraint: must be fast');
      expect(atom.body).not.toContain(`${MOCK_ID_KEY}: 12345678`);
    });

    it('should handle empty bodies gracefully', async () => {
      const trailers = `${MOCK_ID_KEY}: 12345678`;
      const raw: RawCommit = {
        hash: 'h1',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: sub',
        body: trailers,
        trailers: trailers,
      };
      vi.mocked(gitClient.log).mockResolvedValue([raw]);

      const [atom] = await repo.findAll();
      expect(atom.body).toBe('');
    });
  });

  describe('followLinks Integration (End-to-End)', () => {
    it('should transitively resolve links when followLinks is enabled', async () => {
      const trailersA = `${MOCK_ID_KEY}: aaaaaaaa\nRelated: bbbbbbbb`;
      const trailersB = `${MOCK_ID_KEY}: bbbbbbbb`;

      const commitA: RawCommit = {
        hash: 'hash-a',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: a',
        body: 'Main body a',
        trailers: trailersA,
      };
      const commitB: RawCommit = {
        hash: 'hash-b',
        date: '2026-01-02T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: b',
        body: 'Main body b',
        trailers: trailersB,
      };

      vi.mocked(gitClient.log)
        .mockResolvedValueOnce([commitA])
        .mockResolvedValueOnce([commitB]);

      const options: SearchOptions = {
        scope: null,
        follow: true,
        all: false,
        author: null,
        limit: null,
        maxCommits: null,
        since: null,
        until: null,
        confidence: null,
        scopeRisk: null,
        reversibility: null,
        has: null,
        text: null,
      };

      let atoms = await repo.findByTarget(['--', 'file.ts'], options);
      atoms = await repo.resolveFollowLinks(atoms, 1);

      expect(atoms).toHaveLength(2);
      const ids = atoms.map(a => a.protocols.get('mock')?.trailers[MOCK_ID_KEY]?.[0]);
      expect(ids).toContain('aaaaaaaa');
      expect(ids).toContain('bbbbbbbb');
      
      const secondCallArgs = vi.mocked(gitClient.log).mock.calls[1][0];
      expect(secondCallArgs).toContain(`--grep=^${MOCK_ID_KEY}: bbbbbbbb`);
    });
  });

  describe('findById Robustness (The "Three Pass" System)', () => {
    it('should correctly discard atoms where the target ID is in the body but trailers have a different ID', async () => {
      const targetId = '11111111';
      const actualId = '22222222';

      const commit: RawCommit = {
        hash: 'h-cross-talk',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: cross talk',
        body: `Some text...\n${MOCK_ID_KEY}: ${targetId}\n...more text.`,
        trailers: `${MOCK_ID_KEY}: ${actualId}`,
      };

      vi.mocked(gitClient.log).mockResolvedValue([commit]);

      const result = await repo.findById({ id: targetId });

      expect(result).toBeNull();
    });

    it('should find the atom when trailers match exactly', async () => {
      const targetId = 'aaaaaaaa';
      const commit: RawCommit = {
        hash: 'h-match',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: match',
        body: 'Main body',
        trailers: `${MOCK_ID_KEY}: ${targetId}`,
      };

      vi.mocked(gitClient.log).mockResolvedValue([commit]);

      const result = await repo.findById({ id: targetId });

      expect(result).not.toBeNull();
      expect(result!.protocols.get('mock')?.trailers[MOCK_ID_KEY]?.[0]).toBe(targetId);
    });
  });
});
