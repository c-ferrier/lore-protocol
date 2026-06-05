import { type IGitClient } from '../../../src/engine/interfaces/git-client.js';
import { StalenessDetector } from '../../../src/engine/services/staleness-detector.js';
import { TEST_ENGINE_CONFIG, makeAtom, makeProtocolRegistry, makeMockContext, makeProtocol } from '../../../src/engine/testing.js';
import { STALE_SIGNAL } from '../../../src/engine/util/constants.js';
import { makeMockGitClient } from '../engine-test-utils.js';

import { describe, it, expect, vi, beforeEach } from 'vitest';
;
;
;

describe('StalenessDetector Orchestration (Contract)', () => {
  let gitClient: any;
  let registry: any;
  let detector: StalenessDetector;

  beforeEach(() => {
    gitClient = makeMockGitClient();
    registry = makeProtocolRegistry([makeProtocol()]);
    detector = new StalenessDetector(gitClient, TEST_ENGINE_CONFIG, registry);
  });

  it('should orchestrate Age and Drift signals using IGitClient', async () => {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 400); // > 1 year
    const atom = makeAtom({ date: oldDate, filesChanged: ['src/logic.ts'] });

    // Mock Git: 25 commits since atom for this file (threshold is 20)
    gitClient.countCommitsSince.mockResolvedValue(25);

    const reports = await detector.analyze([atom], new Map());

    expect(reports).toHaveLength(1);
    const reasons = reports[0].reasons;
    
    // 1. Age signal triggered
    expect(reasons.some(r => r.signal === STALE_SIGNAL.AGE)).toBe(true);
    
    // 2. Drift signal triggered (threshold is 10)
    expect(reasons.some(r => r.signal === STALE_SIGNAL.DRIFT)).toBe(true);
    expect(gitClient.countCommitsSince).toHaveBeenCalledWith('src/logic.ts', atom.commitHash);
  });

  it('should delegate to protocols for domain-specific signals', async () => {
    const protocol = makeMockContext({
        name: 'mock',
        trailers: { 
            Confidence: { 
                description: 'conf', 
                stale_if: { kind: 'value-equals', value: 'low', signal: STALE_SIGNAL.CONFIDENCE } 
            } as any 
        }
    });

    const registry = makeProtocolRegistry([protocol]);
    const detector = new StalenessDetector(gitClient, TEST_ENGINE_CONFIG, registry);

    const atom = makeAtom({ date: new Date(), trailers: { Confidence: ['low'] } });
    const reports = await detector.analyze([atom], new Map());

    console.log('DEBUG: Reasons:', JSON.stringify(reports[0].reasons));

    expect(reports).toHaveLength(1);
    // Find the confidence signal
    expect(reports[0].reasons.some(r => r.signal === 'value-match')).toBe(true);
  });

  it('should handle Git errors gracefully during drift check', async () => {
    const atom = makeAtom({ date: new Date(), filesChanged: ['deleted.ts'] });
    gitClient.countCommitsSince.mockRejectedValue(new Error('Git error'));

    const reports = await detector.analyze([atom], new Map());
    expect(reports).toHaveLength(0);
  });
});