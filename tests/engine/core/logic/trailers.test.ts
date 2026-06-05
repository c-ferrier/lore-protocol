import { parseTrailers, serializeTrailers } from '../../../..//src/engine/core/logic/trailers.js';

import { describe, it, expect } from 'vitest';

describe('Trailer Logic (Pure Functions)', () => {

  describe('parseTrailers', () => {
    it('should parse simple trailers', () => {
      const raw = 'Key: value';
      const result = parseTrailers(raw);
      expect(result.Key).toEqual(['value']);
    });

    it('should parse multiple trailers with same key', () => {
      const raw = 'Constraint: c1\nConstraint: c2';
      const result = parseTrailers(raw);
      expect(result.Constraint).toEqual(['c1', 'c2']);
    });

    it('should handle continuation lines', () => {
      const raw = 'Constraint: line1\n  line2';
      const result = parseTrailers(raw);
      expect(result.Constraint).toEqual(['line1 line2']);
    });

    it('should handle continuation lines with tabs', () => {
      const raw = 'Constraint: First part\n\tsecond part';
      const result = parseTrailers(raw);
      expect(result.Constraint).toEqual(['First part second part']);
    });

    it('should handle multiple continuation lines', () => {
      const raw = 'Key: v1\n  v2\n  v3';
      const result = parseTrailers(raw);
      expect(result.Key).toEqual(['v1 v2 v3']);
    });

    it('should trim values', () => {
      const raw = 'Key:   value   ';
      const result = parseTrailers(raw);
      expect(result.Key).toEqual(['value']);
    });

    it('should handle unicode in trailer values', () => {
      const raw = 'Constraint: Must support emoji \u{1F680} and CJK \u4E16\u754C';
      const result = parseTrailers(raw);
      expect(result.Constraint).toEqual(['Must support emoji \u{1F680} and CJK \u4E16\u754C']);
    });

    it('should handle trailers with colons in the value', () => {
      const raw = 'Constraint: Time format: HH:MM:SS';
      const result = parseTrailers(raw);
      expect(result.Constraint).toEqual(['Time format: HH:MM:SS']);
    });

    it('should skip blank lines between trailers', () => {
      const raw = 'K1: v1\n\nK2: v2';
      const result = parseTrailers(raw);
      expect(result.K1).toEqual(['v1']);
      expect(result.K2).toEqual(['v2']);
    });

    it('should ignore lines that do not match trailer pattern (no colon)', () => {
        const raw = 'Key: value\nNot-A-Trailer\nOther: v2';
        const result = parseTrailers(raw);
        expect(result.Key).toEqual(['value']);
        expect(result.Other).toEqual(['v2']);
        expect(result['Not-A-Trailer']).toBeUndefined();
    });

    it('should handle trailers with empty values', () => {
        const raw = 'Key: ';
        const result = parseTrailers(raw);
        expect(result.Key).toEqual(['']);
    });
  });

  describe('serializeTrailers', () => {
    it('should serialize trailers', () => {
      const trailers = { Key: ['v1', 'v2'] };
      const result = serializeTrailers(trailers);
      expect(result).toBe('Key: v1\nKey: v2');
    });

    it('should respect authorizedKeys order', () => {
      const trailers = { B: ['vb'], A: ['va'] };
      const result = serializeTrailers(trailers, ['A', 'B']);
      expect(result).toBe('A: va\nB: vb');
    });

    it('should include unauthorized keys after authorized ones', () => {
        const trailers = { Extra: ['e1'], Known: ['k1'] };
        const result = serializeTrailers(trailers, ['Known']);
        expect(result).toBe('Known: k1\nExtra: e1');
    });

    it('should not serialize empty trailers', () => {
      const trailers = { Key: [] };
      const result = serializeTrailers(trailers);
      expect(result).toBe('');
    });

    it('should handle complex multi-value serialization', () => {
        const trailers = {
            'Mock-id': ['a1'],
            'Constraint': ['c1', 'c2']
        };
        const result = serializeTrailers(trailers, ['Mock-id', 'Constraint']);
        expect(result).toBe('Mock-id: a1\nConstraint: c1\nConstraint: c2');
    });
  });
});