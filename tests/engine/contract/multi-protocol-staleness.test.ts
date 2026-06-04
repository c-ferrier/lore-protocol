import { type Atom } from '../../../src/engine/core/types/domain.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { StalenessDetector } from '../../../src/engine/services/staleness-detector.js';
import { TEST_ENGINE_CONFIG } from '../../../src/engine/testing.js';
import { STALE_SIGNAL } from '../../../src/engine/util/constants.js';
import { makeMockProtocol } from '../engine-test-utils.js';

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('StalenessDetector (Multi-Protocol Aggregation)', () => {
  let registry: ProtocolRegistry;
  let detector: StalenessDetector;

  const mockAtom: Atom = {
    commitHash: 'h1',
    date: new Date(),
    author: 'dev@example.com',
    subject: 'feat: multi-protocol atom',
    body: '',
    protocols: new Map([
        ['mockstale', { trailers: {}, unauthorized: {} }],
        ['secstale', { trailers: {}, unauthorized: {} }]
    ]),
    filesChanged: [],
  };

  beforeEach(() => {
    registry = new ProtocolRegistry();
    detector = new StalenessDetector({} as any, TEST_ENGINE_CONFIG, registry);
  });

  it('should aggregate staleness signals from multiple protocols for a single atom', async () => {
    // 1. Mock protocol identifies an expired hint
    const mockProtocol = makeMockProtocol({
        name: 'MockStale',
        namespace: 'mockstale',
        getStaleSignals: vi.fn().mockReturnValue([{ 
            signal: 'expired-hint', 
            description: '[Mock] Hint expired' 
        }])
    });

    // 2. Security protocol identifies low confidence
    const secProtocol = makeMockProtocol({
        name: 'SecStale',
        namespace: 'secstale',
        getStaleSignals: vi.fn().mockReturnValue([{ 
            signal: STALE_SIGNAL.DRIFT, 
            description: '[Sec] Schema drift' 
        }])
    });


    registry.register(mockProtocol);
    registry.register(secProtocol);

    const reports = await detector.analyze([mockAtom], new Map());

    expect(reports).toHaveLength(1);
    const reasons = reports[0].reasons;
    expect(reasons).toHaveLength(2);
    expect(reasons.some(r => r.description.includes('[Mock]'))).toBe(true);
    expect(reasons.some(r => r.description.includes('[Sec]'))).toBe(true);
  });
});
