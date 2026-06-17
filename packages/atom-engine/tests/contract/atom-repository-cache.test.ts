import { beforeEach,describe, expect, it, vi } from 'vitest';

import * as HydrationLogic from '../../src/core/logic/hydration.js';
import { ProtocolMap } from '../../src/core/models/protocol-map.js';
import { type RawCommit } from '../../src/interfaces/git-client.js';
import { findAtoms } from '../../src/shell/orchestrators/discovery.js';
import { makeAtom, makeStubProtocolContext,type ProtocolContext,TEST_PROTOCOL_DEFINITION } from '../../src/testing.js';
import { makeMockGitClient, makeMockInfra } from '../engine-test-utils.js';
import { type MockedGitClient } from '../mock-types.js';

const TEST_ID_KEY = "Mock-id";

describe('Discovery Cache Interaction', () => {
  let git: MockedGitClient;
  let protocols: ProtocolMap<ProtocolContext>;

  beforeEach(() => {
    git = makeMockGitClient();

    const protocol = makeStubProtocolContext(TEST_PROTOCOL_DEFINITION);
    protocols = new ProtocolMap();
    protocols.set(protocol.name, protocol);
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
    git.queryStream.mockImplementation(async function* () { yield* [mockCommit]; });
    const mockAtoms = [makeAtom({ commitHash: mockCommit.hash })];
    vi.spyOn(HydrationLogic, 'hydrateAtoms').mockReturnValue(mockAtoms);

    const infra = makeMockInfra({
        git,
        protocols,
    });

    const result = await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] });

    expect(result).toStrictEqual(mockAtoms);
    expect(HydrationLogic.hydrateAtoms).toHaveBeenCalledWith([mockCommit], protocols, { includeAllCommits: undefined });
  });
});