import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { AtomRepository } from '../../../../src/engine/services/atom-repository.js';
import { SearchFilter } from '../../../../src/engine/services/search-filter.js';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import { NullAtomCache } from '../../../../src/engine/services/atom-cache.js';
import { NullQueryCache } from '../../../../src/engine/services/query-cache.js';
import type { IGitClient, RawCommit } from '../../../../src/engine/interfaces/git-client.js';
import { makeProtocolConfig, MOCK_CONFIG } from '../test-utils.js';

describe('ID Disambiguation & Qualified Identities', () => {
  let registry: ProtocolRegistry;
  let repo: AtomRepository;
  let gitClient: IGitClient;

  // Protocol A: Root namespace, ID key is 'Alpha-id'
  const PROTOCOL_A: ProtocolDefinition = {
    name: 'Alpha',
    version: '1.0',
    identityKey: 'Alpha-id',
    namespace: '',
    strict: false,
    permissive: false,
    trailers: {
      'Alpha-id': { description: 'ID', validation: 'pattern' as const, pattern: '^[0-9a-f]{8}$', isCore: true }
    }
  };

  // Protocol B: Root namespace, ID key is 'Beta-id'
  const PROTOCOL_B: ProtocolDefinition = {
    name: 'Beta',
    version: '1.0',
    identityKey: 'Beta-id',
    namespace: '',
    strict: false,
    permissive: false,
    trailers: {
      'Beta-id': { description: 'ID', validation: 'pattern' as const, pattern: '^[0-9a-f]{8}$', isCore: true }
    }
  };

  beforeEach(() => {
    gitClient = {
      log: vi.fn(async () => []),
      getCommitsByHashes: vi.fn(async () => []),
      getFilesChanged: vi.fn(async () => new Map()),
      resolveRef: vi.fn(async () => 'head'),
      resolveDate: vi.fn(async (d) => new Date(d)),
    } as any;

    registry = new ProtocolRegistry();
    const alpha = new Protocol(PROTOCOL_A, makeProtocolConfig({ permissive: false }));
    const beta = new Protocol(PROTOCOL_B, makeProtocolConfig({ permissive: false }));
    
    registry.register(alpha);
    registry.register(beta);

    repo = new AtomRepository(
      gitClient,
      new TrailerParser(),
      registry,
      new SearchFilter(registry),
      new NullAtomCache(),
      new NullQueryCache()
    );
  });

  describe('Ambiguity Enforcement', () => {
    it('should throw ProtocolError when resolving an ambiguous raw ID without context', () => {
      const targetId = 'deadbeef';
      expect(() => registry.resolveIdentity(targetId)).toThrow(/Ambiguous ID "deadbeef" matches multiple protocols/);
    });

    it('should resolve correctly when an explicit prefix is provided', () => {
      const result = registry.resolveIdentity('alpha/deadbeef');
      expect(result).toEqual({ protocol: 'alpha', id: 'deadbeef' });
    });

    it('should resolve correctly when a default context is provided', () => {
      const result = registry.resolveIdentity('deadbeef', 'beta');
      expect(result).toEqual({ protocol: 'beta', id: 'deadbeef' });
    });
  });

  describe('Deterministic Search', () => {
    it('findById should return the correct atom when protocol is qualified', async () => {
      const targetId = 'deadbeef';

      const commitBeta: RawCommit = {
        hash: 'h_beta',
        date: '2023-01-02T00:00:00Z',
        author: 'b',
        subject: 's',
        body: 'b',
        trailers: 'Beta-id: deadbeef'
      };

      const commitAlpha: RawCommit = {
        hash: 'h_alpha',
        date: '2023-01-01T00:00:00Z',
        author: 'a',
        subject: 's',
        body: 'b',
        trailers: 'Alpha-id: deadbeef'
      };

      vi.mocked(gitClient.log).mockResolvedValue([commitBeta, commitAlpha]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([
        ['h_beta', []],
        ['h_alpha', []]
      ]));

      const result = await repo.findById({ id: targetId, protocol: 'alpha' });

      expect(result?.commitHash).toBe('h_alpha');
      expect(result?.protocols.has('alpha')).toBe(true);
    });

    it('findByIds should return all atoms matching specific qualified identities', async () => {
      const targetId = 'deadbeef';

      const commitBeta: RawCommit = {
        hash: 'h_beta',
        date: '2023-01-02T00:00:00Z',
        author: 'b',
        subject: 's',
        body: 'b',
        trailers: 'Beta-id: deadbeef'
      };

      const commitAlpha: RawCommit = {
        hash: 'h_alpha',
        date: '2023-01-01T00:00:00Z',
        author: 'a',
        subject: 's',
        body: 'b',
        trailers: 'Alpha-id: deadbeef'
      };

      vi.mocked(gitClient.log).mockResolvedValue([commitBeta, commitAlpha]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([
        ['h_beta', []],
        ['h_alpha', []]
      ]));

      const results = await repo.findByIds([
        { id: targetId, protocol: 'alpha' }, 
        { id: targetId, protocol: 'beta' }
      ]);

      expect(results).toHaveLength(2);
      expect(results.some(r => r.commitHash === 'h_beta')).toBe(true);
      expect(results.some(r => r.commitHash === 'h_alpha')).toBe(true);
    });
  });
});
