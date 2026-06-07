import { beforeEach, describe, expect, it } from 'vitest';

import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { analyzeStaleness } from '../../../../src/engine/shell/orchestrators/staleness.js';
import { makeStubProtocolContext, makeStubProtocolRegistry } from '../../../../src/engine/testing.js';
import { STALE_SIGNAL } from '../../../../src/engine/util/constants.js';
import { 
    makeAtom, 
    makeMockAtomRepository, 
    TEST_ENGINE_CONFIG 
} from '../../engine-test-utils.js';

describe('analyzeStaleness (Shell Orchestrator)', () => {
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = makeMockAtomRepository();
  });

  const getDeps = (registry?: any) => ({
    atomRepository: mockRepo,
    config: TEST_ENGINE_CONFIG,
    protocolRegistry: registry || new ProtocolRegistry()
  });

  it('should orchestrate Age and Drift signals using Repository', async () => {
    const atom = makeAtom({ 
        date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365), // 1 year old
        filesChanged: ['src/logic.ts'] 
    });

    // Mock Repository: 25 commits since atom for this file (threshold is 20)
    mockRepo.getAtomDrift.mockResolvedValue({ 'src/logic.ts': 25 });

    const reports = await analyzeStaleness([atom], new Map(), getDeps());

    expect(reports).toHaveLength(1);
    const reasons = reports[0].reasons;

    // 1. Age signal triggered
    expect(reasons.some(r => r.signal === STALE_SIGNAL.AGE)).toBe(true);

    // 2. Drift signal triggered
    expect(reasons.some(r => r.signal === STALE_SIGNAL.DRIFT)).toBe(true);
    expect(reasons.find(r => r.signal === STALE_SIGNAL.DRIFT)?.description)
        .toBe('src/logic.ts has 25 commits since this atom (threshold: 20)');
    expect(mockRepo.getAtomDrift).toHaveBeenCalledWith(atom);
  });

  it('should delegate to protocols for domain-specific signals', async () => {
    const protocol = makeStubProtocolContext({
        name: 'mock',
        trailers: {
            Confidence: {
                description: 'conf',
                multivalue: false,
                validation: 'none',
                stale_if: { kind: 'value-equals' as const, value: 'low', signal: 'confidence' }
            }
        }
    });

    const registry = makeStubProtocolRegistry([protocol]);
    const atom = makeAtom({ date: new Date(), trailers: { Confidence: ['low'] } });
    mockRepo.getAtomDrift.mockResolvedValue({});

    const reports = await analyzeStaleness([atom], new Map(), getDeps(registry));

    expect(reports).toHaveLength(1);
    expect(reports[0].reasons.some(r => r.signal === 'confidence')).toBe(true);
  });

  it('should handle Git errors gracefully during drift check', async () => {
    const atom = makeAtom({ date: new Date(), filesChanged: ['deleted.ts'] });
    mockRepo.getAtomDrift.mockRejectedValue(new Error('Git error'));

    const reports = await analyzeStaleness([atom], new Map(), getDeps());

    // Should still return, just without the drift signal
    expect(reports).toHaveLength(0);
  });
});