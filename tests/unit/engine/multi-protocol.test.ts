import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { SearchFilter } from '../../../src/engine/services/search-filter.js';
import { TrailerParser } from '../../../src/engine/services/trailer-parser.js';
import { NullAtomCache } from '../../../src/engine/services/atom-cache.js';
import { NullQueryCache } from '../../../src/engine/services/query-cache.js';
import type { IGitClient, RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { 
  MOCK_PROTOCOL_DEFINITION, 
  MOCK_CONFIG, 
  makeProtocolConfig,
  makeProtocol
} from './test-utils.js';

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
      'Fred-id': { description: 'ID', multivalue: false, validation: 'pattern' as const, pattern: '^[a-z0-9]+$' },
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
    const mock = makeProtocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(MOCK_CONFIG));
    const fred = makeProtocol(FRED_DEF, makeProtocolConfig(MOCK_CONFIG));
    
    registry.register(mock);
    registry.register(fred);

    repo = new AtomRepository(
      gitClient,
      new TrailerParser(),
      registry,
      new SearchFilter(registry),
      new NullAtomCache(),
      new NullQueryCache()
    );
  });

  it('Discovery: should aggregate discovery patterns from all protocols', async () => {
    await repo.findAll({});
    const args = vi.mocked(gitClient.log).mock.calls[0][0];
    
    // Aggregate pattern: Mock-id (root) OR fred: (namespaced coarse pass)
    const combined = args.find(a => a.startsWith('--grep='));
    expect(combined).toContain('Mock-id');
    expect(combined).toContain('fred:');
    expect(args).toContain('--extended-regexp');
  });

  it('Ownership: should respect namespaced trailers', async () => {
    // New Format: "Namespace: Key: value"
    const trailers = 'Mock-id: abcd1234\nfred: Fred-id: fred1234\nfred: Impact: high\nAdhoc: value';
    const commit: RawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers
    };

    vi.mocked(gitClient.log).mockResolvedValue([commit]);
    vi.mocked(gitClient.getFilesChanged).mockResolvedValue(new Map([['h1', []]]));

    const [atom] = await repo.findAll();
    
    const mockState = atom.protocols.get('mock')!;
    const fredState = atom.protocols.get('fred')!;

    // Mock is permissive in root namespace, so it gets Mock-id and Adhoc
    expect(mockState.trailers['Mock-id']).toEqual(['abcd1234']);
    expect(mockState.trailers['Adhoc']).toEqual(['value']);
    
    // Mock should NOT get fred/Impact
    expect(mockState.trailers['fred']).toBeUndefined();
    expect(mockState.trailers['Impact']).toBeUndefined();

    // Fred gets its own namespaced trailer
    expect(fredState.trailers['Impact']).toEqual(['high']);
    expect(fredState.trailers['Fred-id']).toEqual(['fred1234']);
  });

  it('Conflict: should not allow two permissive protocols in the same namespace', () => {
    const anotherPermissive = makeProtocol({
      ...FRED_DEF,
      name: 'Another',
      namespace: '', // Root namespace
      permissive: true
    }, makeProtocolConfig(MOCK_CONFIG));

    // Mock is already registered in root namespace and is permissive
    expect(() => registry.register(anotherPermissive)).toThrow(/Only one permissive protocol is allowed per namespace/);
  });
});
