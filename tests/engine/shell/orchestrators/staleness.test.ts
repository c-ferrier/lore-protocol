import { beforeEach, describe, expect, it } from 'vitest';

import { ProtocolMap } from '../../../../src/engine/core/models/protocol-map.js';
import { analyzeStaleness } from '../../../../src/engine/shell/orchestrators/staleness.js';
import { makeStubProtocolContext, type ProtocolContext } from '../../../../src/engine/testing.js';
import { STALE_SIGNAL } from '../../../../src/engine/util/constants.js';
import { type MockedGitClient } from '../../../mock-types.js';
import { 
    makeAtom, 
    makeMockGitClient, 
    TEST_ENGINE_CONFIG 
} from '../../engine-test-utils.js';

describe('analyzeStaleness (Shell Orchestrator)', () => {
  let git: MockedGitClient;

  beforeEach(() => {
    git = makeMockGitClient();
  });

  const getDeps = (protocols?: ProtocolMap<ProtocolContext>) => ({
    gitClient: git,
    config: TEST_ENGINE_CONFIG,
    protocols: protocols || new ProtocolMap()
  });

  it('should orchestrate Age and Drift signals using Git', async () => {
    const atom = makeAtom({ 
        date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365), // 1 year old
        filesChanged: ['src/logic.ts'] 
    });

    // Mock Git: 25 commits since atom for this file (threshold is 20)
    // getAtomDrift uses git.getFilesChangedSince
    git.getFilesChangedSince.mockResolvedValue(new Array(25).fill('src/logic.ts'));

    const reports = await analyzeStaleness([atom], new Map(), getDeps());

    expect(reports).toHaveLength(1);
    const reasons = reports[0].reasons;

    // 1. Age signal triggered
    expect(reasons.some(r => r.signal === STALE_SIGNAL.AGE)).toBe(true);

    // 2. Drift signal triggered
    expect(reasons.some(r => r.signal === STALE_SIGNAL.DRIFT)).toBe(true);
    expect(reasons.find(r => r.signal === STALE_SIGNAL.DRIFT)?.description)
        .toBe('src/logic.ts has 25 commits since this atom (threshold: 20)');
    expect(git.getFilesChangedSince).toHaveBeenCalledWith(atom.commitHash);
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

    const protocols = new ProtocolMap<ProtocolContext>();
    protocols.set(protocol.name, protocol);
    const atom = makeAtom({ date: new Date(), trailers: { Confidence: ['low'] } });
    git.getFilesChangedSince.mockResolvedValue([]);

    const reports = await analyzeStaleness([atom], new Map(), getDeps(protocols));

    expect(reports).toHaveLength(1);
    expect(reports[0].reasons.some(r => r.signal === 'confidence')).toBe(true);
  });

  it('should handle Git errors gracefully during drift check', async () => {
    const atom = makeAtom({ date: new Date(), filesChanged: ['deleted.ts'] });
    git.getFilesChangedSince.mockRejectedValue(new Error('Git error'));

    const reports = await analyzeStaleness([atom], new Map(), getDeps());

    // Should still return, just without the drift signal
    expect(reports).toHaveLength(0);
  });
});