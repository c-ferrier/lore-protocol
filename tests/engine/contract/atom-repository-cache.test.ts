import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import type { IGitClient, RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { TEST_PROTOCOL_DEFINITION, makeAtomRepository, makeProtocol, makeMockAtomHydrator } from '../engine-test-utils.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { PathResolver } from '../../../src/engine/services/path-resolver.js';

const TEST_ID_KEY = "Mock-id";

describe('AtomRepository Cache Interaction', () => {
  let gitClient: IGitClient;
  let repo: AtomRepository;
  let hydrator: any;
  let protocolRegistry: ProtocolRegistry;

  beforeEach(() => {
    gitClient = {
      log: vi.fn(),
      getCommitsByHashes: vi.fn(async () => []),
      resolveDate: vi.fn(async (d: string) => new Date(d)),
      resolveRef: vi.fn(async () => 'head'),
    } as any;

    const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
    protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(protocol);

    hydrator = makeMockAtomHydrator();

    repo = makeAtomRepository({
        gitClient,
        registry: protocolRegistry,
        hydrator,
        pathResolver: new PathResolver('/mock', '/mock'),
    });
  });

  const mockCommit: RawCommit = {
    hash: 'abc12345',
    date: '2025-01-15T10:00:00Z',
    author: 'dev@example.com',
    subject: 'feat(auth): add login',
    body: 'Implemented login flow.',
    trailers: `${TEST_ID_KEY}: a1b2c3d4`,
  };

  it('should delegate hydration to AtomHydrator', async () => {
    vi.mocked(gitClient.log).mockResolvedValue([mockCommit]);
    const mockAtoms = [{ commitHash: mockCommit.hash } as any];
    vi.mocked(hydrator.hydrate).mockResolvedValue(mockAtoms);

    const result = await repo.find();

    expect(result).toStrictEqual(mockAtoms);
    expect(hydrator.hydrate).toHaveBeenCalledWith([mockCommit]);
  });
});
