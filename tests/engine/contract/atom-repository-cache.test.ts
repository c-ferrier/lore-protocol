import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import type { IGitClient, RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { TEST_PROTOCOL_DEFINITION, makeAtomRepository, makeProtocol, makeMockAtomHydrator, makeMockGitClient, makeAtom, makeQueryTarget } from '../engine-test-utils.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { PathResolver } from '../../../src/engine/services/path-resolver.js';

const TEST_ID_KEY = "Mock-id";

describe('AtomRepository Cache Interaction', () => {
  let gitClient: any;
  let repo: AtomRepository;
  let hydrator: any;
  let protocolRegistry: ProtocolRegistry;

  beforeEach(() => {
    gitClient = makeMockGitClient();

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
    filesChanged: ['src/main.ts']
  };

  it('should delegate hydration to AtomHydrator', async () => {
    vi.mocked(gitClient.query).mockResolvedValue([mockCommit]);
    const mockAtoms = [makeAtom({ commitHash: mockCommit.hash })];
    vi.mocked(hydrator.hydrate).mockReturnValue(mockAtoms);

    const result = await repo.find();

    expect(result).toStrictEqual(mockAtoms);
    expect(hydrator.hydrate).toHaveBeenCalledWith([mockCommit]);
  });
});
