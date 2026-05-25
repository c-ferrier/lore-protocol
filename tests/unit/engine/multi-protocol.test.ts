import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { SearchFilter } from '../../../src/engine/services/search-filter.js';
import { TrailerParser } from '../../../src/engine/services/trailer-parser.js';
import { NullAtomCache } from '../../../src/engine/services/atom-cache.js';
import { NullQueryCache } from '../../../src/engine/services/query-cache.js';
import type { IGitClient, RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { LORE_DEFAULT_CONFIG } from '../../../src/lore/defaults.js';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';

describe('Multi-Protocol Integration', () => {
  let registry: ProtocolRegistry;
  let repo: AtomRepository;
  let gitClient: IGitClient;

  const FRED_DEF = {
    name: 'Fred',
    version: '1.0',
    identityKey: 'Fred-id',
    namespace: 'fred',
    trailers: {
      'Fred-id': { description: 'ID', validation: 'none' as const },
      'Impact': { description: 'Impact', validation: 'none' as const }
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
    const lore = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);
    const fred = new Protocol(FRED_DEF, LORE_DEFAULT_CONFIG);
    
    registry.register(lore);
    registry.register(fred);

    repo = new AtomRepository(
      gitClient,
      new TrailerParser(),
      lore,
      registry,
      new SearchFilter(registry),
      new NullAtomCache(),
      new NullQueryCache()
    );
  });

  it('Discovery: should aggregate discovery patterns from all protocols', async () => {
    await repo.findAll({});
    const args = vi.mocked(gitClient.log).mock.calls[0][0];
    
    // Pattern for Lore-id and fred/Fred-id
    expect(args.some(a => a.includes('Lore-id') && a.includes('fred/Fred-id'))).toBe(true);
    expect(args).toContain('--extended-regexp');
  });

  it('Ownership: should respect namespaced trailers', async () => {
    const trailers = 'Lore-id: lore123\nfred/Fred-id: fred456\nfred/Impact: high\nAdhoc: value';
    const commit: RawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers
    };

    vi.mocked(gitClient.log).mockResolvedValue([commit]);

    const [atom] = await repo.findAll();
    
    const loreState = atom.protocols.get('lore')!;
    const fredState = atom.protocols.get('fred')!;

    // Lore is permissive in root namespace, so it gets Lore-id and Adhoc
    expect(loreState.trailers['Lore-id']).toEqual(['lore123']);
    expect(loreState.trailers['Adhoc']).toEqual(['value']);
    
    // Lore should NOT get fred/Impact
    expect(loreState.trailers['fred/Impact']).toBeUndefined();
    expect(loreState.trailers['Impact']).toBeUndefined();

    // Fred gets its own namespaced trailer
    expect(fredState.trailers['Impact']).toEqual(['high']);
    
    // Identity key was NOT Fred-id in the raw trailers (it was Lore-id)
    // Fred protocol only claims namespaced trailers if it also has its identity key, 
    // OR if it's explicitly defined. Fred defines 'Impact'.
  });

  it('Conflict: should not allow two permissive protocols in the same namespace', () => {
    const anotherPermissive = new Protocol({
      ...FRED_DEF,
      name: 'Another',
      namespace: '' // Root namespace
    }, LORE_DEFAULT_CONFIG);

    // Lore is already registered in root namespace and is permissive
    expect(() => registry.register(anotherPermissive)).toThrow(/Only one permissive protocol is allowed per namespace/);
  });
});
