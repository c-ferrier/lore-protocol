import { describe, it, expect, vi } from 'vitest';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';
import { LORE_STALE_SIGNAL } from '../../../src/lore/constants.js';
import type { Atom, SupersessionStatus } from '../../../src/engine/types/domain.js';

describe('LoreProtocolDefinition Hooks', () => {
  describe('getStaleSignals', () => {
    const makeMockAtom = (loreTrailers: Record<string, string[]>): Atom => ({
      commitHash: 'h1',
      date: new Date(),
      author: 'a',
      subject: 's',
      body: '',
      protocols: new Map([
        ['lore', { name: 'Lore', version: '1.0', identityKey: 'Lore-id', trailers: loreTrailers }]
      ]),
      filesChanged: []
    });

    it('should flag "low-confidence" signal when Confidence is low', () => {
      const atom = makeMockAtom({ Confidence: ['low'] });
      const signals = LoreProtocolDefinition.getStaleSignals!(atom, new Date(), new Map());
      
      expect(signals).toHaveLength(1);
      expect(signals[0].signal).toBe(LORE_STALE_SIGNAL.LOW_CONFIDENCE);
      expect(signals[0].description).toContain('[Lore]');
    });

    it('should flag "expired-hint" when an [until:date] directive has passed', () => {
      // Date in the past
      const atom = makeMockAtom({ Directive: ['Cleanup [until:2020-01-01]'] });
      const signals = LoreProtocolDefinition.getStaleSignals!(atom, new Date(), new Map());
      
      expect(signals.some(s => s.signal === LORE_STALE_SIGNAL.EXPIRED_HINT)).toBe(true);
    });

    it('should flag "orphaned-dep" when a dependency is superseded', () => {
      const atom = makeMockAtom({ 'Depends-on': ['old-id'] });
      const statusMap = new Map<string, SupersessionStatus>([
          ['old-id', { superseded: true, supersededBy: 'new-id' }]
      ]);
      
      const signals = LoreProtocolDefinition.getStaleSignals!(atom, new Date(), statusMap);
      expect(signals.some(s => s.signal === 'orphaned-dep')).toBe(true);
      expect(signals[0].description).toContain('superseded by new-id');
    });

    it('should return empty array if no lore interpretation exists', () => {
      const atom: Atom = { ...makeMockAtom({}), protocols: new Map() };
      const signals = LoreProtocolDefinition.getStaleSignals!(atom, new Date(), new Map());
      expect(signals).toHaveLength(0);
    });
  });
});
