import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StalenessDetector } from '../../../../src/engine/services/staleness-detector.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { STALE_SIGNAL } from '../../../../src/util/constants.js';
import type { Atom } from '../../../../src/engine/types/domain.js';
import { MOCK_CONFIG } from '../test-utils.js';

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
        ['mock', { name: 'Mock', version: '1.0', identityKey: 'Mock-id', trailers: {} }],
        ['sec', { name: 'Sec', version: '1.0', identityKey: 'CVE-id', trailers: {} }]
    ]),
    filesChanged: [],
  };

  beforeEach(() => {
    registry = new ProtocolRegistry();
    detector = new StalenessDetector({} as any, MOCK_CONFIG, registry);
  });

  it('should aggregate staleness signals from multiple protocols for a single atom', async () => {
    // 1. Mock protocol identifies an expired hint
    const mockProtocol: any = {
        name: 'Mock',
        getStaleSignals: vi.fn().mockReturnValue([{ 
            signal: STALE_SIGNAL.EXPIRED_HINT, 
            description: '[Mock] Hint expired' 
        }])
    };

    // 2. Security protocol identifies low confidence
    const secProtocol: any = {
        name: 'Sec',
        getStaleSignals: vi.fn().mockReturnValue([{ 
            signal: STALE_SIGNAL.LOW_CONFIDENCE, 
            description: '[Sec] Vulnerability detected' 
        }])
    };

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
