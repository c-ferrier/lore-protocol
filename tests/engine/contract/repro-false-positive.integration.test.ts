import { beforeEach,describe, expect, it, vi } from 'vitest';

import { ProtocolMap } from '../../../src/engine/core/models/protocol-map.js';
import { type RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { findAtomById,findAtoms } from '../../../src/engine/shell/orchestrators/discovery.js';
import { makeStubProtocolContext, type ProtocolContext } from '../../../src/engine/testing.js';
import { type MockedGitClient } from '../../mock-types.js';
import { makeMockGitClient, makeMockInfra } from '../engine-test-utils.js';

describe('Discovery False Positive Repro', () => {
  let git: MockedGitClient;
  let protocols: ProtocolMap<ProtocolContext>;
  const protocol = makeStubProtocolContext({
    name: 'Mock',
    identityKey: 'Mock-id',
    trailers: {
      'Mock-id': { description: 'ID', multivalue: false, validation: 'pattern', pattern: '^[0-9a-f]{8}$', isCore: true }
    }
  });

  beforeEach(() => {
    git = makeMockGitClient();
    protocols = new ProtocolMap<ProtocolContext>();
    protocols.set(protocol.name, protocol);
  });

  const getInfra = () => makeMockInfra({
      git,
      protocols
  });

  it('findAtomById should use an anchored grep (repro failure)', async () => {
    const targetId = 'aaaa1111';
    const commit: RawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: `this subject contains ${targetId} by accident`,
      body: 'b',
      trailers: 'Mock-id: bbbb2222',
      filesChanged: []
    };

    vi.mocked(git.query).mockResolvedValue([commit]);

    const infra = getInfra();
    // Should return null because trailers didn't match targetId
    const result = await findAtomById(infra, { id: targetId });
    expect(result).toBeNull();
  });

  it('findAtoms (global) should use an anchored grep (repro failure)', async () => {
    const commit: RawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 'this subject contains Mock-id: aaaa1111 by accident',
      body: 'b',
      trailers: 'Adhoc: value',
      filesChanged: []
    };

    vi.mocked(git.query).mockResolvedValue([commit]);

    const infra = getInfra();
    // Should return 0 atoms because although Git might return the commit due to subject text,
    // the trailers do not contain the Mock-id protocol sentinel.
    const results = await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] });
    expect(results).toHaveLength(0);
  });
});