import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StalenessDetector } from '../../../../src/engine/services/staleness-detector.js';
import type { IGitClient } from '../../../../src/engine/interfaces/git-client.js';
import type { EngineConfig, SupersessionStatus } from '../../../../src/engine/types/config.js';
import type { Atom, StaleReason } from '../../../../src/engine/types/domain.js';
import { STALE_SIGNAL } from '../../../../src/engine/util/constants.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import type { IProtocol } from '../../../../src/engine/interfaces/protocol.js';
import { MOCK_CONFIG, makeProtocol } from '../test-utils.js';

const MOCK_ID_KEY = "Mock-id";

function createMockGitClient(overrides: Partial<IGitClient> = {}): IGitClient {
  return {
    log: vi.fn(async () => []),
    blame: vi.fn(async () => []),
    commit: vi.fn(async () => ({ hash: 'abc123', success: true, message: '' })),
    hasStagedChanges: vi.fn(async () => false),
    getRepoRoot: vi.fn(async () => '/repo'),
    isInsideRepo: vi.fn(async () => true),
    getFilesChanged: vi.fn(async () => new Map()),
    countCommitsSince: vi.fn(async () => 0),
    resolveRef: vi.fn(async () => 'abc123'),
    ...overrides,
  } as any;
}

function createDefaultConfig(overrides: Partial<EngineConfig['stale']> = {}): EngineConfig {
  return {
    ...MOCK_CONFIG,
    stale: {
      ...MOCK_CONFIG.stale,
      ...overrides,
    },
  };
}

/**
 * A truly generic Mock Protocol for engine-level testing.
 * Implements staleness logic similar to Mock but without depending on it.
 */
function createMockProtocol(): IProtocol {
  return {
    name: 'mock',
    version: '1.0',
    namespace: '',
    identityKey: MOCK_ID_KEY,
    permissive: true,
    getAuthorizedKeys: vi.fn(() => []),
    getDefinition: vi.fn(() => undefined),
    getReferenceKeys: vi.fn(() => ['Supersedes', 'Depends-on']),
    isValidIdentity: vi.fn((id) => /^[a-f0-9]{8}$/.test(id)),
    getIdentity: vi.fn((trailers) => trailers?.[MOCK_ID_KEY]?.[0] || null),
    setRegistry: vi.fn(),
    
    // Core Engine Logic Test: verify that the detector delegates to this method
    getStaleSignals: vi.fn((atom: Atom, now: Date, globalSupersessionMap: Map<string, Map<string, SupersessionStatus>>): StaleReason[] => {
      const reasons: StaleReason[] = [];
      const state = atom.protocols.get('mock');
      if (!state) return [];

      const supersessionMap = globalSupersessionMap.get('mock') || new Map();

      // 1. Simulate 'low-confidence' signal
      if (state.trailers.Confidence?.[0] === 'low') {
        reasons.push({ signal: STALE_SIGNAL.LOW_CONFIDENCE, description: '[mock] Atom is marked as Confidence: low' });
      }

      // 2. Simulate 'expired-hint' signal using simplified date logic for tests
      const parseUntilDate = (dateStr: string): Date | null => {
          const m = dateStr.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
          if (!m) return null;
          return new Date(parseInt(m[1]), parseInt(m[2]) - 1, m[3] ? parseInt(m[3]) : 1);
      };

      for (const directive of state.trailers.Directive || []) {
          const match = directive.match(/\[until:([^\]]+)\]/);
          if (match) {
              const expiry = parseUntilDate(match[1]);
              if (expiry && now > expiry) {
                  reasons.push({ signal: STALE_SIGNAL.EXPIRED_HINT, description: `[mock] Directive "${directive}" has expired` });
              }
          }
      }

      // 3. Simulate 'orphaned-dep' signal
      const deps = state.trailers['Depends-on'] || [];
      for (const id of deps) {
          const status = supersessionMap.get(id);
          if (status?.superseded) {
              reasons.push({ signal: STALE_SIGNAL.ORPHANED_DEP, description: `[mock] Dependency "${id}" has been superseded` });
          }
      }

      return reasons;
    }),
  } as any;
}

function makeAtom(options: {
  id?: string;
  commitHash?: string;
  date?: Date;
  confidence?: string;
  directives?: string[];
  dependsOn?: string[];
  filesChanged?: string[];
}): Atom {
  const id = options.id ?? 'a1b2c3d4';
  const protocols = new Map();
  protocols.set('mock', {
    name: 'mock',
    version: '1.0',
    identityKey: MOCK_ID_KEY,
    trailers: {
      [MOCK_ID_KEY]: [id],
      Confidence: options.confidence ? [options.confidence] : [],
      Directive: options.directives ?? [],
      'Depends-on': options.dependsOn ?? [],
    },
    unauthorized: {},
  });

  return {
    commitHash: options.commitHash ?? 'abc12345',
    date: options.date ?? new Date('2025-01-15T10:00:00Z'),
    author: 'dev@example.com',
    subject: 'feat: test commit',
    body: '',
    protocols,
    filesChanged: options.filesChanged ?? [],
  };
}

function makeGlobalSupersessionMap(entries: Array<[string, { superseded: boolean; supersededBy: string | null }]>): Map<string, Map<string, SupersessionStatus>> {
  const statusMap = new Map(entries);
  return new Map([['mock', statusMap]]);
}

describe('StalenessDetector', () => {
  let gitClient: IGitClient;
  let config: EngineConfig;
  let protocol: IProtocol;
  let registry: ProtocolRegistry;
  let detector: StalenessDetector;

  beforeEach(() => {
    gitClient = createMockGitClient();
    config = createDefaultConfig();
    protocol = createMockProtocol();
    registry = new ProtocolRegistry();
    registry.register(protocol);
    detector = new StalenessDetector(gitClient, config, registry);
  });

  describe('analyze', () => {
    describe('age signal', () => {
      it('should detect atoms older than the configured threshold', async () => {
        // Atom is 1 year old, threshold is 6 months
        const oldDate = new Date();
        oldDate.setFullYear(oldDate.getFullYear() - 1);

        const atom = makeAtom({ date: oldDate });
        const result = await detector.analyze([atom], makeGlobalSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === STALE_SIGNAL.AGE)).toBe(true);
      });

      it('should not flag atoms newer than the threshold', async () => {
        // Atom is 1 day old, threshold is 6 months
        const recentDate = new Date();
        recentDate.setDate(recentDate.getDate() - 1);

        const atom = makeAtom({ date: recentDate });
        const result = await detector.analyze([atom], makeGlobalSupersessionMap([]));

        expect(result).toHaveLength(0);
      });

      it('should respect custom age threshold', async () => {
        config = createDefaultConfig({ olderThan: '30d' });
        detector = new StalenessDetector(gitClient, config, registry);

        // Atom is 60 days old, threshold is 30 days
        const date = new Date();
        date.setDate(date.getDate() - 60);

        const atom = makeAtom({ date });
        const result = await detector.analyze([atom], makeGlobalSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === STALE_SIGNAL.AGE && r.description.includes('30d'))).toBe(true);
      });

      it('should handle year duration format', async () => {
        config = createDefaultConfig({ olderThan: '1y' });
        detector = new StalenessDetector(gitClient, config, registry);

        // Atom is 2 years old
        const date = new Date();
        date.setFullYear(date.getFullYear() - 2);

        const atom = makeAtom({ date });
        const result = await detector.analyze([atom], makeGlobalSupersessionMap([]));

        expect(result).toHaveLength(1);
      });

      it('should handle week duration format', async () => {
        config = createDefaultConfig({ olderThan: '2w' });
        detector = new StalenessDetector(gitClient, config, registry);

        // Atom is 3 weeks old
        const date = new Date();
        date.setDate(date.getDate() - 21);

        const atom = makeAtom({ date });
        const result = await detector.analyze([atom], makeGlobalSupersessionMap([]));

        expect(result).toHaveLength(1);
      });
    });

    describe('drift signal', () => {
      it('should detect files with too many commits since the atom', async () => {
        vi.mocked(gitClient.countCommitsSince).mockResolvedValue(25);

        const atom = makeAtom({
          date: new Date(), // recent, so age won't trigger
          filesChanged: ['src/auth.ts'],
        });

        const result = await detector.analyze([atom], makeGlobalSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === STALE_SIGNAL.DRIFT)).toBe(true);
        expect(result[0].reasons.some((r) => r.signal === STALE_SIGNAL.DRIFT && r.description.includes('20'))).toBe(true);
      });

      it('should not flag files under the drift threshold', async () => {
        vi.mocked(gitClient.countCommitsSince).mockResolvedValue(5);

        const atom = makeAtom({
          date: new Date(),
          filesChanged: ['src/auth.ts'],
        });

        const result = await detector.analyze([atom], makeGlobalSupersessionMap([]));

        expect(result).toHaveLength(0);
      });

      it('should check drift for each file in filesChanged', async () => {
        vi.mocked(gitClient.countCommitsSince)
          .mockResolvedValueOnce(5)   // auth.ts: under threshold
          .mockResolvedValueOnce(30); // db.ts: over threshold

        const atom = makeAtom({
          date: new Date(),
          filesChanged: ['src/auth.ts', 'src/db.ts'],
        });

        const result = await detector.analyze([atom], makeGlobalSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === STALE_SIGNAL.DRIFT && r.description.includes('1 files'))).toBe(true);
      });

      it('should handle errors from countCommitsSince gracefully', async () => {
        vi.mocked(gitClient.countCommitsSince).mockRejectedValue(new Error('file not found'));

        const atom = makeAtom({
          date: new Date(),
          filesChanged: ['deleted-file.ts'],
        });

        const result = await detector.analyze([atom], makeGlobalSupersessionMap([]));

        // Should not crash, and should not add a drift reason for the deleted file
        expect(result).toHaveLength(0);
      });

      it('should respect custom drift threshold', async () => {
        config = createDefaultConfig({ driftThreshold: 5 });
        detector = new StalenessDetector(gitClient, config, registry);
        vi.mocked(gitClient.countCommitsSince).mockResolvedValue(10);

        const atom = makeAtom({
          date: new Date(),
          filesChanged: ['src/auth.ts'],
        });

        const result = await detector.analyze([atom], makeGlobalSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === STALE_SIGNAL.DRIFT && r.description.includes('5'))).toBe(true);
      });
    });

    describe('protocol-specific signals (delegation)', () => {
      it('should detect atoms with Confidence: low', async () => {
        const atom = makeAtom({
          date: new Date(),
          confidence: 'low',
        });

        const result = await detector.analyze([atom], makeGlobalSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === STALE_SIGNAL.LOW_CONFIDENCE)).toBe(true);
      });

      it('should not flag atoms with Confidence: medium', async () => {
        const atom = makeAtom({
          date: new Date(),
          confidence: 'medium',
        });

        const result = await detector.analyze([atom], makeGlobalSupersessionMap([]));

        expect(result).toHaveLength(0);
      });

      it('should detect expired [until:YYYY-MM] directives', async () => {
        const atom = makeAtom({
          date: new Date(),
          directives: ['Migrate to v2 API [until:2024-06]'],
        });

        const result = await detector.analyze([atom], makeGlobalSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === STALE_SIGNAL.EXPIRED_HINT)).toBe(true);
      });

      it('should handle directives without [until:] hints', async () => {
        const atom = makeAtom({
          date: new Date(),
          directives: ['Keep this module small'],
        });

        const result = await detector.analyze([atom], makeGlobalSupersessionMap([]));

        expect(result).toHaveLength(0);
      });

      it('should detect dependencies on superseded atoms', async () => {
        const atom = makeAtom({
          date: new Date(),
          dependsOn: ['bbbb2222'],
        });

        const statusMap = makeGlobalSupersessionMap([
          ['bbbb2222', { superseded: true, supersededBy: 'cccc3333' }],
        ]);

        const result = await detector.analyze([atom], statusMap);

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === STALE_SIGNAL.ORPHANED_DEP)).toBe(true);
      });

      it('should not flag dependencies on active atoms', async () => {
        const atom = makeAtom({
          date: new Date(),
          dependsOn: ['bbbb2222'],
        });

        const statusMap = makeGlobalSupersessionMap([
          ['bbbb2222', { superseded: false, supersededBy: null }],
        ]);

        const result = await detector.analyze([atom], statusMap);

        expect(result).toHaveLength(0);
      });
    });

    describe('combined signals', () => {
      it('should report multiple staleness reasons for one atom', async () => {
        vi.mocked(gitClient.countCommitsSince).mockResolvedValue(30);

        const oldDate = new Date();
        oldDate.setFullYear(oldDate.getFullYear() - 2);

        const atom = makeAtom({
          date: oldDate,
          confidence: 'low',
          directives: ['Remove flag [until:2024-01]'],
          filesChanged: ['src/auth.ts'],
          dependsOn: ['bbbb2222'],
        });

        const statusMap = makeGlobalSupersessionMap([
          ['bbbb2222', { superseded: true, supersededBy: 'cccc3333' }],
        ]);

        const result = await detector.analyze([atom], statusMap);

        expect(result).toHaveLength(1);
        // Should have all 5 signals
        const signals = result[0].reasons.map(r => r.signal);
        expect(signals).toContain(STALE_SIGNAL.AGE);
        expect(signals).toContain(STALE_SIGNAL.DRIFT);
        expect(signals).toContain(STALE_SIGNAL.LOW_CONFIDENCE);
        expect(signals).toContain(STALE_SIGNAL.EXPIRED_HINT);
        expect(signals).toContain(STALE_SIGNAL.ORPHANED_DEP);
      });

      it('should analyze multiple atoms independently', async () => {
        const oldDate = new Date();
        oldDate.setFullYear(oldDate.getFullYear() - 1);

        const staleAtom = makeAtom({ id: 'aaaa1111', date: oldDate });
        const freshAtom = makeAtom({ id: 'bbbb2222', date: new Date() });

        const result = await detector.analyze([staleAtom, freshAtom], makeGlobalSupersessionMap([]));

        expect(result).toHaveLength(1);
        const state = result[0].atom.protocols.get('mock');
        expect(state?.trailers[MOCK_ID_KEY][0]).toBe('aaaa1111');
      });

      it('should handle empty atom list', async () => {
        const result = await detector.analyze([], makeGlobalSupersessionMap([]));

        expect(result).toHaveLength(0);
      });
    });
  });
});
