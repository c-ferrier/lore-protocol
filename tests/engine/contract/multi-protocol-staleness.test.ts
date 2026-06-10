import { beforeEach, describe, expect, it } from 'vitest';

import { analyzeStaleness } from '../../../src/engine/shell/orchestrators/staleness.js';
import { makeStubProtocolContext, makeStubProtocolRegistry } from '../../../src/engine/testing.js';
import { type MockedAtomRepository } from '../../mock-types.js';
import { 
    makeAtom, 
    makeMockAtomRepository, 
    ProtocolMap,
    ProtocolState,
    TEST_ENGINE_CONFIG 
} from '../engine-test-utils.js';

describe('analyzeStaleness (Multi-Protocol Aggregation)', () => {
  let _mockRepo: MockedAtomRepository;

  beforeEach(() => {
    _mockRepo = makeMockAtomRepository();
  });

  it('should aggregate staleness signals from multiple protocols for a single atom', async () => {
    const p1 = makeStubProtocolContext({
      name: 'p1',
      identityKey: 'P1-id',
      trailers: { 
          'P1-id': { description: 'ID', multivalue: false, validation: 'none' },
          'Status': { 
              description: 'S', 
              multivalue: false,
              validation: 'none',
              stale_if: { kind: 'value-equals' as const, value: 'stale', signal: 'p1-signal' } 
          }
      }
    });
    const p2 = makeStubProtocolContext({
      name: 'p2',
      identityKey: 'P2-id',
      namespace: 'p2',
      trailers: { 
          'P2-id': { description: 'ID', multivalue: false, validation: 'none' },
          'Level': { 
              description: 'L', 
              multivalue: false,
              validation: 'none',
              stale_if: { kind: 'value-equals' as const, value: 'high', signal: 'p2-signal' } 
          }
      }
    });

    const reg = makeStubProtocolRegistry([p1, p2]);
    const atom = makeAtom({
      protocols: new ProtocolMap<ProtocolState>([
        ['p1', { trailers: { 'Status': ['stale'] }, unauthorized: {} }],
        ['p2', { trailers: { 'Level': ['high'] }, unauthorized: {} }]
      ])
    });

    const mockRepo = makeMockAtomRepository();
    mockRepo.getAtomDrift.mockResolvedValue({});

    const deps = {
        atomRepository: mockRepo,
        config: TEST_ENGINE_CONFIG,
        protocolRegistry: reg
    };

    const reports = await analyzeStaleness([atom], new Map(), deps);

    expect(reports).toHaveLength(1);
    const signals = reports[0].reasons.map(r => r.signal);
    expect(signals).toContain('p1-signal');
    expect(signals).toContain('p2-signal');
  });
});
