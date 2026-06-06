import { beforeEach, describe, expect, it } from 'vitest';

import { analyzeStaleness } from '../../../src/engine/shell/orchestrators/staleness.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { 
    makeAtom, 
    makeMockAtomRepository, 
    makeProtocolRegistry, 
    TEST_ENGINE_CONFIG 
} from '../engine-test-utils.js';

describe('analyzeStaleness (Multi-Protocol Aggregation)', () => {
  let registry: ProtocolRegistry;

  beforeEach(() => {
    registry = new ProtocolRegistry();
  });

  it('should aggregate staleness signals from multiple protocols for a single atom', async () => {
    const p1 = {
      name: 'p1',
      identityKey: 'P1-id',
      trailers: { 
          'P1-id': { description: 'ID', validation: 'none' },
          'Status': { 
              description: 'S', 
              stale_if: { kind: 'value-equals', value: 'stale', signal: 'p1-signal' } 
          }
      }
    };
    const p2 = {
      name: 'p2',
      identityKey: 'P2-id',
      namespace: 'p2',
      trailers: { 
          'P2-id': { description: 'ID', validation: 'none' },
          'Level': { 
              description: 'L', 
              stale_if: { kind: 'value-equals', value: 'high', signal: 'p2-signal' } 
          }
      }
    };

    const reg = makeProtocolRegistry([p1, p2]);
    const atom = makeAtom({
      protocols: new Map([
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
