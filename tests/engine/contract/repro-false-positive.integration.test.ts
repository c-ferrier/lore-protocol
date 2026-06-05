import { beforeEach,describe, expect, it, vi } from 'vitest';

import { type RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { makeProtocol } from '../../../src/engine/testing.js';
import { makeAtomRepository, makeMockGitClient } from '../engine-test-utils.js';
;


;

describe('AtomRepository False Positive Repro', () => {
  let gitClient: any;
  let repository: any;
  const protocol = makeProtocol({
    name: 'Mock',
    identityKey: 'Mock-id',
    trailers: {
      'Mock-id': { description: 'ID', multivalue: false, validation: 'pattern', pattern: '^[0-9a-f]{8}$', isCore: true }
    }
  });

  beforeEach(() => {
    gitClient = makeMockGitClient();
    const registry = new ProtocolRegistry();
    registry.register(protocol);
    
    repository = makeAtomRepository({ gitClient, registry });
  });

  it('findById should use an anchored grep (repro failure)', async () => {
    const targetId = 'aaaa1111';
    const commit: RawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: `this subject contains ${targetId} by accident`,
      body: 'b',
      trailers: 'Mock-id: bbbb2222'
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
      trailers: 'Adhoc: value'
    };

    vi.mocked(gitClient.query).mockResolvedValue([commit]);

    // Should return 0 atoms because although Git might return the commit due to subject text,
    // the trailers do not contain the Mock-id protocol sentinel.
    const results = await repository.find();
    expect(results).toHaveLength(0);
  });
});