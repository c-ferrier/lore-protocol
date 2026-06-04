import { evaluateAgeSignal, evaluateDriftSignal, formatAge, parseDuration } from '../../../src/engine/core/logic/staleness.js';
import { type Atom } from '../../../src/engine/core/types/domain.js';
import { STALE_SIGNAL } from '../../../src/engine/util/constants.js';

import { describe, it, expect } from 'vitest';
;
;

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
    it('should return null if no files exceed the drift threshold', () => {
      const driftMap = { 'src/a.ts': 5, 'src/b.ts': 9 };
      const signal = evaluateDriftSignal(driftMap, 10);
      expect(signal).toBeNull();
    });

    it('should return a reason if any file exceeds the drift threshold', () => {
      const driftMap = { 'src/a.ts': 5, 'src/b.ts': 15 };
      const signal = evaluateDriftSignal(driftMap, 10);
      
      expect(signal).not.toBeNull();
      expect(signal?.signal).toBe(STALE_SIGNAL.DRIFT);
      expect(signal?.description).toContain('Source files have drifted');
      expect(signal?.description).toContain('1 files');
    });

    it('should handle empty drift map', () => {
        const signal = evaluateDriftSignal({}, 10);
        expect(signal).toBeNull();
    });
  });
});