import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import type { RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { makeProtocol, makeAtomRepository } from './../engine-test-utils.js';

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
    gitClient = {
      log: vi.fn().mockResolvedValue([]),
      resolveRef: vi.fn().mockResolvedValue('head'),
      getFilesChanged: vi.fn().mockResolvedValue(new Map()),
      resolveDate: vi.fn().mockImplementation(async (d) => new Date(d)),
    };
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

    gitClient.log.mockResolvedValue([commit]);

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

    gitClient.log.mockResolvedValue([commit]);

    const results = await repository.find();
    expect(results).toHaveLength(0);
  });
});
