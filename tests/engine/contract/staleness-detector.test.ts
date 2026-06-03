import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StalenessDetector } from '../../../src/engine/services/staleness-detector.js';
import { 
    makeMockGitClient, 
    makeProtocolRegistry, 
    makeProtocol, 
    makeAtom, 
    TEST_ENGINE_CONFIG,
    TEST_ID_KEY
} from '../engine-test-utils.js';
import { STALE_SIGNAL } from '../../../src/engine/util/constants.js';

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
    const protocol = makeProtocol({
        name: 'mock',
        trailers: { Confidence: { description: 'conf' } }
    });
    // Force a protocol-level stale signal
    vi.spyOn(protocol, 'getStaleSignals').mockReturnValue([{
        signal: STALE_SIGNAL.CONFIDENCE,
        description: 'Low confidence'
    }]);

    const registry = makeProtocolRegistry([protocol]);
    const detector = new StalenessDetector(gitClient, TEST_ENGINE_CONFIG, registry);

    const atom = makeAtom({ date: new Date(), trailers: { Confidence: ['low'] } });
    const reports = await detector.analyze([atom], new Map());

    expect(reports).toHaveLength(1);
    // Find the confidence signal
    expect(reports[0].reasons.some(r => r.signal === STALE_SIGNAL.CONFIDENCE)).toBe(true);
  });

  it('should handle Git errors gracefully during drift check', async () => {
    const atom = makeAtom({ date: new Date(), filesChanged: ['deleted.ts'] });
    gitClient.countCommitsSince.mockRejectedValue(new Error('Git error'));

    const reports = await detector.analyze([atom], new Map());
    expect(reports).toHaveLength(0);
  });
});
