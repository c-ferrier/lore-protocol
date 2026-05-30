import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../../src/engine/services/atom-repository.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { PathResolver } from '../../../../src/engine/services/path-resolver.js';
import { SearchFilter } from '../../../../src/engine/services/search-filter.js';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import { NullAtomCache } from '../../../../src/engine/services/atom-cache.js';
import { NullQueryCache } from '../../../../src/engine/services/query-cache.js';
import type { IGitClient, RawCommit } from '../../../../src/engine/interfaces/git-client.js';
import { makeProtocol, makeAtomRepository } from '../test-utils.js';

describe('AtomRepository Identity Disambiguation', () => {
  let gitClient: IGitClient;
  let repo: AtomRepository;
  let protocolRegistry: ProtocolRegistry;

  const ALPHA_DEF = {
    name: 'Alpha',
    version: '1.0',
    identityKey: 'Alpha-id',
    namespace: 'alpha',
    trailers: {
      'Alpha-id': { description: 'ID', multivalue: false, validation: 'pattern' as const, pattern: '^[0-9a-f]{8}$' },
    }
  };

  const BETA_DEF = {
    name: 'Beta',
    version: '1.0',
    identityKey: 'Beta-id',
    namespace: 'beta',
    trailers: {
      'Beta-id': { description: 'ID', multivalue: false, validation: 'pattern' as const, pattern: '^[0-9a-f]{8}$' },
    }
  };

  beforeEach(() => {
    gitClient = {
      log: vi.fn(async () => []),
      getCommitsByHashes: vi.fn(async () => []),
      getFilesChanged: vi.fn(async () => new Map()),
      resolveRef: vi.fn(async () => 'head'),
      resolveDate: vi.fn(async (d: string) => new Date(d)),
    } as any;

    protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(makeProtocol(ALPHA_DEF));
    protocolRegistry.register(makeProtocol(BETA_DEF));

    repo = makeAtomRepository({
        gitClient,
        registry: protocolRegistry,
        pathResolver: new PathResolver('/mock', '/mock')
    });
  });

  it('should find an atom using a qualified ID (alpha/12345678)', async () => {
    const targetId = '12345678';
    const commit: RawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: `alpha: Alpha-id: ${targetId}`,
    };

    vi.mocked(gitClient.log).mockResolvedValue([commit]);

    const result = await repo.findById({ id: targetId, protocol: 'alpha' });

    expect(result).not.toBeNull();
    const state = result!.protocols.get('alpha')!;
    expect((state as any).trailers['Alpha-id'][0]).toBe(targetId);
    
    // Ensure we used a specific grep
    const args = vi.mocked(gitClient.log).mock.calls[0][0];
    expect(args.some(a => a.includes('alpha: Alpha-id: 12345678'))).toBe(true);
  });

  it('should find an atom using a qualified ID (beta/12345678)', async () => {
    const targetId = '12345678';
    const commit: RawCommit = {
      hash: 'h2',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: `beta: Beta-id: ${targetId}`,
    };

    vi.mocked(gitClient.log).mockResolvedValue([commit]);

    const result = await repo.findById({ id: targetId, protocol: 'beta' });

    expect(result).not.toBeNull();
    expect(result!.protocols.has('beta')).toBe(true);
  });

  it('should resolve ambiguous IDs by checking all protocols (three-pass)', async () => {
    const targetId = '12345678';
    // Commit only has Beta ID
    const commit: RawCommit = {
      hash: 'h2',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: `beta: Beta-id: ${targetId}`,
    };

    vi.mocked(gitClient.log).mockResolvedValue([commit]);

    // Query without protocol prefix
    const result = await repo.findById({ id: targetId });

    expect(result).not.toBeNull();
    expect(result!.protocols.has('beta')).toBe(true);
    
    // Verification: ensure the grep included both possible patterns
    const args = vi.mocked(gitClient.log).mock.calls[0][0];
    const combinedGrep = args.find(a => a.startsWith('--grep='));
    expect(combinedGrep).toContain('alpha: Alpha-id: 12345678');
    expect(combinedGrep).toContain('beta: Beta-id: 12345678');
  });
});
