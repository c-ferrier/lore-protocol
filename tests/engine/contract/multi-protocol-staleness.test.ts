import { type Atom, ProtocolMap } from '../../../src/engine/core/types/domain.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { StalenessDetector } from '../../../src/engine/services/staleness-detector.js';
import { TEST_ENGINE_CONFIG, makeMockContext } from '../../../src/engine/testing.js';
import { STALE_SIGNAL } from '../../../src/engine/util/constants.js';
import { makeMockProtocolContext } from '../engine-test-utils.js';

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
    protocols: new ProtocolMap([
        ['mockstale', { trailers: {}, unauthorized: {} }],
        ['secstale', { trailers: {}, unauthorized: {} }]
    ]),
    filesChanged: new Set(),
  };

  beforeEach(() => {
    registry = new ProtocolRegistry();
    detector = new StalenessDetector({} as any, TEST_ENGINE_CONFIG, registry);
  });

  it('should aggregate staleness signals from multiple protocols for a single atom', async () => {
    // 1. Mock protocol identifies an expired hint
    const mockProtocol = makeMockContext({
        name: 'MockStale',
        namespace: 'mockstale',
        trailers: {
            'Hint': { 
                description: 'H', 
                stale_if: { kind: 'value-equals', value: 'expired', signal: 'expired-hint' }
            } as any
        }
    });

    // 2. Security protocol identifies low confidence
    const secProtocol = makeMockContext({
        name: 'SecStale',
        namespace: 'secstale',
        trailers: {
            'Drift': { 
                description: 'D', 
                stale_if: { kind: 'value-equals', value: 'drift', signal: STALE_SIGNAL.DRIFT } 
            } as any
        }
    });


    registry.register(mockProtocol);
    registry.register(secProtocol);

    const atom: Atom = {
        commitHash: 'h1',
        date: new Date(),
        author: 'dev@example.com',
        subject: 'feat: multi-protocol atom',
        body: '',
        protocols: new ProtocolMap([
            ['mockstale', { trailers: { 'Hint': ['expired'] }, unauthorized: {} }],
            ['secstale', { trailers: { 'Drift': ['drift'] }, unauthorized: {} }]
        ]),
        filesChanged: new Set(),
      };

    const reports = await detector.analyze([atom], new Map());

    expect(reports).toHaveLength(1);
    const reasons = reports[0].reasons;
    expect(reasons).toHaveLength(2);
    expect(reasons.some(r => r.signal === 'expired-hint')).toBe(true);
    expect(reasons.some(r => r.signal === STALE_SIGNAL.DRIFT)).toBe(true);
  });
});
