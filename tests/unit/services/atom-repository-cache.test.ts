import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../src/services/atom-repository.js';
import { Protocol } from '../../../src/services/protocol.js';
import { LoreProtocolDefinition } from '../../../src/protocols/lore.js';
import { SearchFilter } from '../../../src/services/search-filter.js';
import { TrailerParser } from '../../../src/services/trailer-parser.js';
import { NullQueryCache } from '../../../src/services/query-cache.js';
import type { IGitClient, RawCommit } from '../../../src/interfaces/git-client.js';
import type { IAtomCache } from '../../../src/interfaces/atom-cache.js';
import { DEFAULT_CONFIG } from '../../../src/util/constants.js';

import { ProtocolRegistry } from '../../../src/services/protocol-registry.js';

const LORE_ID_KEY = "Lore-id";

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

    const protocol = new Protocol(LoreProtocolDefinition, DEFAULT_CONFIG);
    protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(protocol);
    trailerParser = new TrailerParser();
    atomCache = {
      getFiles: vi.fn(async () => null),
      setFiles: vi.fn(async () => {}),
    };

    repo = new AtomRepository(
      gitClient,
      trailerParser,
      protocol,
      protocolRegistry,
      new SearchFilter(),
      atomCache,
      new NullQueryCache()
    );
  });

  const mockLoreCommit: RawCommit = {
    hash: 'abc12345',
    date: '2025-01-15T10:00:00Z',
    author: 'dev@example.com',
    subject: 'feat: test',
    body: '',
    trailers: `${LORE_ID_KEY}: a1b2c3d4`,
  };

  it('should use cached files and skip git lookup on cache hit', async () => {
    const cachedFiles = ['src/main.ts', 'tests/main.test.ts'];
    vi.mocked(gitClient.log).mockResolvedValue([mockLoreCommit]);
    vi.mocked(atomCache.getFiles).mockResolvedValue(cachedFiles);

    const atoms = await repo.findAll();

    expect(atoms).toHaveLength(1);
    expect(atoms[0].filesChanged).toEqual(cachedFiles);
    
    // Core assertions:
    expect(atomCache.getFiles).toHaveBeenCalledWith(mockLoreCommit.hash);
    expect(gitClient.getFilesChanged).not.toHaveBeenCalled();
  });

  it('should hit git and update cache on cache miss', async () => {
    const gitFiles = ['src/new.ts'];
    vi.mocked(gitClient.log).mockResolvedValue([mockLoreCommit]);
    vi.mocked(atomCache.getFiles).mockResolvedValue(null); // Miss
    vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([[mockLoreCommit.hash, gitFiles]]));

    const atoms = await repo.findAll();

    expect(atoms).toHaveLength(1);
    expect(atoms[0].filesChanged).toEqual(gitFiles);

    // Core assertions:
    expect(atomCache.getFiles).toHaveBeenCalledWith(mockLoreCommit.hash);
    expect(gitClient.getFilesChanged).toHaveBeenCalledWith([mockLoreCommit.hash]);
    expect(atomCache.setFiles).toHaveBeenCalledWith(mockLoreCommit.hash, gitFiles);
  });

  it('should handle partial cache hits in a batch', async () => {
    const commit1 = { ...mockLoreCommit, hash: 'hash1', trailers: `${LORE_ID_KEY}: 11111111` };
    const commit2 = { ...mockLoreCommit, hash: 'hash2', trailers: `${LORE_ID_KEY}: 22222222` };
    
    const cachedFiles = ['src/cached.ts'];
    const gitFiles = ['src/git.ts'];

    vi.mocked(gitClient.log).mockResolvedValue([commit1, commit2]);
    
    // commit1 is a hit, commit2 is a miss
    vi.mocked(atomCache.getFiles).mockImplementation(async (h) => h === 'hash1' ? cachedFiles : null);
    vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['hash2', gitFiles]]));

    const atoms = await repo.findAll();

    expect(atoms).toHaveLength(2);
    expect(atoms.find(a => a.id === '11111111')?.filesChanged).toEqual(cachedFiles);
    expect(atoms.find(a => a.id === '22222222')?.filesChanged).toEqual(gitFiles);

    // Verify git was only called for the miss
    expect(gitClient.getFilesChanged).toHaveBeenCalledWith(['hash2']);
    expect(atomCache.setFiles).toHaveBeenCalledWith('hash2', gitFiles);
    expect(atomCache.setFiles).not.toHaveBeenCalledWith('hash1', expect.anything());
  });
});
