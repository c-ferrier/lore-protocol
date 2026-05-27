import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../../src/engine/services/atom-repository.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { SearchFilter } from '../../../../src/engine/services/search-filter.js';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import { NullQueryCache } from '../../../../src/engine/services/query-cache.js';
import type { IGitClient, RawCommit } from '../../../../src/engine/interfaces/git-client.js';
import type { IAtomCache } from '../../../../src/engine/interfaces/atom-cache.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG } from '../test-utils.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';

const MOCK_ID_KEY = "Mock-id";

describe('AtomRepository Cache Interaction', () => {
  let gitClient: IGitClient;
  let trailerParser: TrailerParser;
  let repo: AtomRepository;
  let atomCache: IAtomCache;
  let protocolRegistry: ProtocolRegistry;

  beforeEach(() => {
    gitClient = {
      log: vi.fn(),
      getFilesChanged: vi.fn(async () => new Map()),
      resolveDate: vi.fn(async (d: string) => new Date(d)),
    } as any;

    const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG);
    protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(protocol);
    trailerParser = new TrailerParser();
    atomCache = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
    };

    repo = new AtomRepository(
      gitClient,
      trailerParser,
      protocolRegistry,
      new SearchFilter(protocolRegistry),
      atomCache,
      new NullQueryCache()
    );
  });

  const mockCommit: RawCommit = {
    hash: 'abc12345',
    date: '2025-01-15T10:00:00Z',
    author: 'dev@example.com',
    subject: 'feat(auth): add login',
    body: 'Implemented login flow.',
    trailers: `${MOCK_ID_KEY}: a1b2c3d4`,
  };

  it('should use cached files and skip git lookup on cache hit', async () => {
    const cachedFiles = ['src/auth.ts', 'src/util.ts'];
    vi.mocked(atomCache.get).mockResolvedValue({ filesChanged: cachedFiles });
    vi.mocked(gitClient.log).mockResolvedValue([mockCommit]);

    const result = await repo.findAll();

    expect(result).toHaveLength(1);
    expect(result[0].filesChanged).toEqual(cachedFiles);
    expect(atomCache.get).toHaveBeenCalledWith(mockCommit.hash);
    expect(gitClient.getFilesChanged).not.toHaveBeenCalled();
  });

  it('should hit git and update cache on cache miss', async () => {
    const gitFiles = ['src/new.ts'];
    vi.mocked(atomCache.get).mockResolvedValue(null); // Miss
    vi.mocked(gitClient.log).mockResolvedValue([mockCommit]);
    vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[mockCommit.hash, gitFiles]]));

    const result = await repo.findAll();

    expect(result).toHaveLength(1);
    expect(result[0].filesChanged).toEqual(gitFiles);
    expect(atomCache.get).toHaveBeenCalledWith(mockCommit.hash);
    expect(gitClient.getFilesChanged).toHaveBeenCalledWith([mockCommit.hash]);
    
    // Verify cache update
    expect(atomCache.set).toHaveBeenCalledWith(mockCommit.hash, { filesChanged: gitFiles });
  });

  it('should handle partial cache hits in a batch', async () => {
    const cachedFiles = ['src/cached.ts'];
    const gitFiles = ['src/git.ts'];
    const mockCommit2: RawCommit = { ...mockCommit, hash: 'hash2', trailers: `${MOCK_ID_KEY}: bbb222` };

    vi.mocked(gitClient.log).mockResolvedValue([
      { ...mockCommit, hash: 'hash1', trailers: `${MOCK_ID_KEY}: aaa111` },
      mockCommit2
    ]);

    vi.mocked(atomCache.get).mockImplementation(async (h) => h === 'hash1' ? { filesChanged: cachedFiles } : null);
    vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['hash2', gitFiles]]));

    const result = await repo.findAll();

    expect(result).toHaveLength(2);
    expect(result[0].filesChanged).toEqual(cachedFiles);
    expect(result[1].filesChanged).toEqual(gitFiles);
    
    // Only hash2 should have been fetched from git
    expect(gitClient.getFilesChanged).toHaveBeenCalledWith(['hash2']);
    expect(atomCache.set).toHaveBeenCalledWith('hash2', { filesChanged: gitFiles });
  });
});
