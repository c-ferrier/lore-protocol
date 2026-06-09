import { beforeEach,describe, expect, it, vi } from 'vitest';

import { type RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { makeAtomRepository,makeStubProtocolContext } from '../../../src/engine/testing.js';
import { makeMockGitClient } from '../engine-test-utils.js';
;


;

describe('AtomRepository False Positive Repro', () => {
  let gitClient: any;
  let repository: any;
  const protocol = makeStubProtocolContext({
    name: 'Mock',
    identityKey: 'Mock-id',
    trailers: {
      'Mock-id': { description: 'ID', multivalue: false, validation: 'pattern', pattern: '^[0-9a-f]{8}$', isCore: true }
    }
  });

  beforeEach(() => {
    gitClient = makeMockGitClient();
    const protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(protocol);
    
    repository = makeAtomRepository({ gitClient, protocolRegistry });
  });

  it('findById should use an anchored grep (repro failure)', async () => {
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

    vi.mocked(gitClient.query).mockResolvedValue([commit]);

    // Should return null because trailers didn't match targetId
    const result = await repository.findById({ id: targetId });
    expect(result).toBeNull();
  });

  it('find (global) should use an anchored grep (repro failure)', async () => {
    const commit: RawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 'this subject contains Mock-id: aaaa1111 by accident',
      body: 'b',
      trailers: 'Adhoc: value',
      filesChanged: []
    };

    vi.mocked(gitClient.query).mockResolvedValue([commit]);

    // Should return 0 atoms because although Git might return the commit due to subject text,
    // the trailers do not contain the Mock-id protocol sentinel.
    const results = await repository.find();
    expect(results).toHaveLength(0);
  });
});