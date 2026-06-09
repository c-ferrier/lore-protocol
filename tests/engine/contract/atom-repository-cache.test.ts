import { beforeEach,describe, expect, it, vi } from 'vitest';

import { type RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { makeAtom, makeAtomRepository,makeStubProtocolContext,TEST_PROTOCOL_DEFINITION } from '../../../src/engine/testing.js';
import { makeMockGitClient } from '../engine-test-utils.js';
;


;
;

import * as HydrationLogic from '../../../src/engine/core/logic/hydration.js';

const TEST_ID_KEY = "Mock-id";

describe('AtomRepository Cache Interaction', () => {
  let gitClient: any;
  let repo: AtomRepository;
  let protocolRegistry: ProtocolRegistry;

  beforeEach(() => {
    gitClient = makeMockGitClient();

    const protocol = makeStubProtocolContext(TEST_PROTOCOL_DEFINITION);
    protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(protocol);

    repo = makeAtomRepository({
        gitClient,
        protocolRegistry,
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

  it('should utilize hydrateAtoms logic module', async () => {
    vi.mocked(gitClient.query).mockResolvedValue([mockCommit]);
    const mockAtoms = [makeAtom({ commitHash: mockCommit.hash })];
    vi.spyOn(HydrationLogic, 'hydrateAtoms').mockReturnValue(mockAtoms);

    const result = await repo.find();

    expect(result).toStrictEqual(mockAtoms);
    expect(HydrationLogic.hydrateAtoms).toHaveBeenCalledWith([mockCommit], protocolRegistry, { includeAllCommits: undefined });
  });
});