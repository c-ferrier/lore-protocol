import { describe, expect,it } from 'vitest';

import { getStaleSignals } from '../../../src/engine/core/logic/staleness.js';
import { type Atom, ProtocolMap,type SupersessionStatus } from '../../../src/engine/core/types/domain.js';
import { makeStubProtocolContext, makeStubProtocolMap, makeStubProtocolState } from '../../../src/engine/testing.js';
import { LORE_STALE_SIGNAL } from '../../../src/lore/constants.js';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';

describe('LoreProtocolDefinition Declarative Triggers', () => {
  const protocol = makeStubProtocolContext(LoreProtocolDefinition);

  const makeMockAtom = (loreTrailers: Record<string, string[]>): Atom => ({
    commitHash: 'h1',
    date: new Date(),
    author: 'a',
    subject: 's',
    body: '',
    rawTrailers: '',
    protocols: makeStubProtocolMap([
      ['lore', makeStubProtocolState({ trailers: loreTrailers })]
    ]),
    filesChanged: []
  });

  describe('getStaleSignals', () => {
    it('should flag "low-confidence" signal when Confidence is low', () => {
      const atom = makeMockAtom({ Confidence: ['low'] });
      const signals = getStaleSignals(protocol, atom, new Date(), new Map());
      
      expect(signals).toHaveLength(1);
      expect(signals[0].signal).toBe(LORE_STALE_SIGNAL.LOW_CONFIDENCE);
      expect(signals[0].description).toContain('[lore]');
    });

    it('should flag "expired-hint" when an [until:date] directive has passed', () => {
      // Date in the past relative to Feb 2020
      const atom = makeMockAtom({ Directive: ['Cleanup [until:2020-01-01]'] });
      const now = new Date(2020, 1, 1); // Feb 1 2020
      const signals = getStaleSignals(protocol, atom, now, new Map());
      
      expect(signals.some(s => s.signal === LORE_STALE_SIGNAL.EXPIRED_HINT)).toBe(true);
    });

    it('should flag "orphaned-dep" when a dependency is superseded', () => {
      const atom = makeMockAtom({ 'Depends-on': ['old-id'] });
      const statusMap = new Map<string, SupersessionStatus>([
          ['old-id', { superseded: true, supersededBy: ['new-id'] }]
      ]);
      const globalStatusMap = new Map([
          ['lore', statusMap]
      ]);

      const signals = getStaleSignals(protocol, atom, new Date(), globalStatusMap);
      expect(signals.some(s => s.signal === 'orphaned-dep')).toBe(true);
      expect(signals[0].description).toContain('superseded by new-id');
    });

    it('should flag "orphaned-dep" when a cross-protocol dependency is superseded', () => {
      const atom = makeMockAtom({ 'Depends-on': ['sec/cve-123'] });
      const statusMap = new Map<string, SupersessionStatus>([
          ['cve-123', { superseded: true, supersededBy: ['sec/cve-456'] }]
      ]);
      const globalStatusMap = new Map([
          ['sec', statusMap]
      ]);

      const signals = getStaleSignals(protocol, atom, new Date(), globalStatusMap);
      expect(signals.some(s => s.signal === 'orphaned-dep')).toBe(true);
      expect(signals[0].description).toContain('Dependency "sec/cve-123"');
      expect(signals[0].description).toContain('superseded by sec/cve-456');
    });

    it('should return empty array if no lore interpretation exists', () => {
      const atom: Atom = { ...makeMockAtom({}), protocols: new ProtocolMap([]) };
      const signals = getStaleSignals(protocol, atom, new Date(), new Map());
      expect(signals).toHaveLength(0);
    });
  });
});