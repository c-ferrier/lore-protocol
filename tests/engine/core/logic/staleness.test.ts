import {describe, expect, it } from 'vitest';

import { 
    evaluateAgeSignal, 
    evaluateDriftSignal,
    formatAge, 
    getProtocolStaleSignals,
    parseDuration} from '../../../../src/engine/core/logic/staleness.js';
import { makeAtom,makeStubProtocolContext } from '../../../../src/engine/testing.js';
import { STALE_SIGNAL } from '../../../../src/engine/util/constants.js';

describe('Staleness Logic (Pure Functions)', () => {

  describe('parseDuration', () => {
    it('should parse days', () => expect(parseDuration('5d')).toBe(5 * 24 * 60 * 60 * 1000));
    it('should parse weeks', () => expect(parseDuration('2w')).toBe(2 * 7 * 24 * 60 * 60 * 1000));
    it('should parse months', () => expect(parseDuration('6m')).toBe(6 * 30 * 24 * 60 * 60 * 1000));
    it('should parse years', () => expect(parseDuration('1y')).toBe(365 * 24 * 60 * 60 * 1000));
    it('should default to 6 months for unknown units', () => expect(parseDuration('5x')).toBe(6 * 30 * 24 * 60 * 60 * 1000));
    it('should return null for completely invalid format', () => expect(parseDuration('invalid')).toBeNull());
  });

  describe('formatAge', () => {
    it('should format days', () => expect(formatAge(3 * 24 * 60 * 60 * 1000)).toBe('3 days'));
    it('should format 1 day', () => expect(formatAge(1 * 24 * 60 * 60 * 1000)).toBe('1 day'));
    it('should format weeks', () => expect(formatAge(14 * 24 * 60 * 60 * 1000)).toBe('2 weeks'));
    it('should format months', () => expect(formatAge(65 * 24 * 60 * 60 * 1000)).toBe('2 months'));
    it('should format years', () => expect(formatAge(400 * 24 * 60 * 60 * 1000)).toBe('1 year'));
  });

  describe('evaluateAgeSignal', () => {
    const now = new Date('2023-06-01T00:00:00Z');

    it('should return null if atom is newer than threshold', () => {
      const atomDate = new Date('2023-05-01T00:00:00Z'); // 1 month old
      const signal = evaluateAgeSignal(atomDate, now, '6m');
      expect(signal).toBeNull();
    });

    it('should return a reason if atom is older than threshold', () => {
      const atomDate = new Date('2022-01-01T00:00:00Z'); // ~1.5 years old
      const signal = evaluateAgeSignal(atomDate, now, '6m');
      
      expect(signal).not.toBeNull();
      expect(signal?.signal).toBe(STALE_SIGNAL.AGE);
      expect(signal?.description).toContain('Atom is older than 6m');
    });

    it('should handle exactly on the threshold', () => {
      const atomDate = new Date(now.getTime() - parseDuration('6m')!);
      const signal = evaluateAgeSignal(atomDate, now, '6m');
      // Threshold check is `>` not `>=`
      expect(signal).toBeNull();
    });
  });

  describe('evaluateDriftSignal', () => {
    it('should return empty array if no files exceed the drift threshold', () => {
      const driftMap = { 'src/a.ts': 5, 'src/b.ts': 9 };
      const signals = evaluateDriftSignal(driftMap, 10);
      expect(signals).toHaveLength(0);
    });

    it('should return reasons if any file exceeds the drift threshold', () => {
      const driftMap = { 'src/a.ts': 5, 'src/b.ts': 15 };
      const signals = evaluateDriftSignal(driftMap, 10);
      
      expect(signals).toHaveLength(1);
      expect(signals[0].signal).toBe(STALE_SIGNAL.DRIFT);
      expect(signals[0].description).toBe('src/b.ts has 15 commits since this atom (threshold: 10)');
    });

    it('should return multiple reasons for multiple drifted files', () => {
        const driftMap = { 'src/a.ts': 12, 'src/b.ts': 15 };
        const signals = evaluateDriftSignal(driftMap, 10);
        expect(signals).toHaveLength(2);
        expect(signals[0].description).toContain('src/a.ts has 12 commits');
        expect(signals[1].description).toContain('src/b.ts has 15 commits');
    });

    it('should handle empty drift map', () => {
        const signals = evaluateDriftSignal({}, 10);
        expect(signals).toHaveLength(0);
    });
  });

  describe('Protocol-Specific Triggers', () => {
    const now = new Date('2023-06-01T00:00:00Z');

    it('should evaluate value-equals condition', () => {
        const ctx = makeStubProtocolContext({
            name: 'mock',
            trailers: { 
                'Status': { 
                    description: 'S', 
                    multivalue: false,
                    validation: 'none' as const,
                    stale_if: { kind: 'value-equals', value: 'deprecated', signal: 'status-deprecated' } 
                }
            }
        });
        const atom = makeAtom({ trailers: { 'Status': ['deprecated'] } });
        const reasons = getProtocolStaleSignals(ctx, atom, now, new Map());
        expect(reasons).toHaveLength(1);
        expect(reasons[0].signal).toBe('status-deprecated');
    });

    it('should evaluate date-expired condition', () => {
        const ctx = makeStubProtocolContext({
            name: 'mock',
            trailers: { 
                'Until': { description: 'U', multivalue: false, validation: 'none' as const, stale_if: { kind: 'date-expired', signal: STALE_SIGNAL.EXPIRED_HINT } }
            }
        });
        // Use a date in the past in YYYY-MM-DD format (supported by parseTriggerHints)
        const pastDate = new Date(now.getTime() - 1000 * 60 * 60 * 48); // 2 days ago
        const pastStr = pastDate.toISOString().split('T')[0]; 

        const atom = makeAtom({ trailers: { 'Until': [`[until:${pastStr}] do something`] } });
        const reasons = getProtocolStaleSignals(ctx, atom, now, new Map());
        expect(reasons).toHaveLength(1);
        expect(reasons[0].signal).toBe(STALE_SIGNAL.EXPIRED_HINT);
    });

    it('should evaluate reference-superseded condition', () => {
        const ctx = makeStubProtocolContext({
            name: 'mock',
            trailers: { 
                'Ref': { description: 'R', multivalue: true, validation: 'reference' as const, stale_if: { kind: 'reference-superseded' } }
            }
        });
        const atom = makeAtom({ trailers: { 'Ref': ['target-1'] } });
        const supersessionMap = new Map([
            ['mock', new Map([['target-1', { superseded: true, supersededBy: ['target-2'] }]])]
        ]);

        const reasons = getProtocolStaleSignals(ctx, atom, now, supersessionMap);
        expect(reasons).toHaveLength(1);
        expect(reasons[0].signal).toBe(STALE_SIGNAL.ORPHANED_DEP);
        expect(reasons[0].description).toContain('superseded by target-2');
    });

    it('should ignore self-supersession in reference signals', () => {
        const ctx = makeStubProtocolContext({
            name: 'mock',
            identityKey: 'Id',
            trailers: { 
                'Id': { description: 'ID', multivalue: false, validation: 'none' as const },
                'Ref': { description: 'R', multivalue: true, validation: 'reference' as const, stale_if: { kind: 'reference-superseded' } }
            }
        });
        // Atom a2 supersedes a1. a2 also references a1 (normal chain).
        const atom = makeAtom({ id: 'a2', trailers: { 'Id': ['a2'], 'Ref': ['a1'] } });
        const supersessionMap = new Map([
            ['mock', new Map([['a1', { superseded: true, supersededBy: ['a2'] }]])]
        ]);

        const reasons = getProtocolStaleSignals(ctx, atom, now, supersessionMap);
        // Should be empty because a2 is the one that superseded a1
        expect(reasons).toHaveLength(0);
    });
  });
});