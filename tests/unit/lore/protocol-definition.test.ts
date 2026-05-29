import { describe, it, expect } from 'vitest';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';
import { LORE_STALE_SIGNAL } from '../../../src/lore/constants.js';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { MOCK_PROTOCOL_CONFIG } from '../engine/test-utils.js';
import type { Atom, SupersessionStatus } from '../../../src/engine/types/domain.js';

describe('LoreProtocolDefinition Declarative Triggers', () => {
  const protocol = new Protocol(LoreProtocolDefinition, MOCK_PROTOCOL_CONFIG);

  const makeMockAtom = (loreTrailers: Record<string, string[]>): Atom => ({
    commitHash: 'h1',
    date: new Date(),
    author: 'a',
    subject: 's',
    body: '',
    protocols: new Map([
      ['lore', { trailers: loreTrailers, unauthorized: {} }]
    ]),
    filesChanged: []
  });

  describe('getStaleSignals', () => {
    it('should flag "low-confidence" signal when Confidence is low', () => {
      const atom = makeMockAtom({ Confidence: ['low'] });
      const signals = protocol.getStaleSignals(atom, new Date(), new Map());
      
      expect(signals).toHaveLength(1);
      expect(signals[0].signal).toBe(LORE_STALE_SIGNAL.LOW_CONFIDENCE);
      expect(signals[0].description).toContain('[Lore]');
    });

    it('should flag "expired-hint" when an [until:date] directive has passed', () => {
      // Date in the past relative to Feb 2020
      const atom = makeMockAtom({ Directive: ['Cleanup [until:2020-01-01]'] });
      const now = new Date(2020, 1, 1); // Feb 1 2020
      const signals = protocol.getStaleSignals(atom, now, new Map());
      
      expect(signals.some(s => s.signal === LORE_STALE_SIGNAL.EXPIRED_HINT)).toBe(true);
    });

    it('should flag "orphaned-dep" when a dependency is superseded', () => {
      const atom = makeMockAtom({ 'Depends-on': ['old-id'] });
      const statusMap = new Map<string, SupersessionStatus>([
          ['old-id', { superseded: true, supersededBy: 'new-id' }]
      ]);
      const globalStatusMap = new Map([
          ['lore', statusMap]
      ]);

      const signals = protocol.getStaleSignals(atom, new Date(), globalStatusMap);
      expect(signals.some(s => s.signal === 'orphaned-dep')).toBe(true);
      expect(signals[0].description).toContain('superseded by new-id');
    });

    it('should flag "orphaned-dep" when a cross-protocol dependency is superseded', () => {
      const atom = makeMockAtom({ 'Depends-on': ['sec/cve-123'] });
      const statusMap = new Map<string, SupersessionStatus>([
          ['cve-123', { superseded: true, supersededBy: 'sec/cve-456' }]
      ]);
      const globalStatusMap = new Map([
          ['sec', statusMap]
      ]);

      const signals = protocol.getStaleSignals(atom, new Date(), globalStatusMap);
      expect(signals.some(s => s.signal === 'orphaned-dep')).toBe(true);
      expect(signals[0].description).toContain('Dependency "sec/cve-123"');
      expect(signals[0].description).toContain('superseded by sec/cve-456');
    });

    it('should return empty array if no lore interpretation exists', () => {
      const atom: Atom = { ...makeMockAtom({}), protocols: new Map() };
      const signals = protocol.getStaleSignals(atom, new Date(), new Map());
      expect(signals).toHaveLength(0);
    });
  });
});
