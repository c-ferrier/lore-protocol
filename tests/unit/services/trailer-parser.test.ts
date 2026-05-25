import { describe, it, expect, beforeEach } from 'vitest';
import { TrailerParser } from '../../../src/engine/services/trailer-parser.js';

describe('TrailerParser', () => {
  let parser: TrailerParser;

  beforeEach(() => {
    parser = new TrailerParser();
  });

  describe('parse', () => {
    it('should parse simple trailers', () => {
      const raw = 'Key: value';
      const result = parser.parse(raw);
      expect(result.Key).toEqual(['value']);
    });

    it('should parse multiple trailers with same key', () => {
      const raw = 'Constraint: c1\nConstraint: c2';
      const result = parser.parse(raw);
      expect(result.Constraint).toEqual(['c1', 'c2']);
    });

    it('should handle continuation lines', () => {
      const raw = 'Constraint: line1\n  line2';
      const result = parser.parse(raw);
      expect(result.Constraint).toEqual(['line1 line2']);
    });

    it('should handle continuation lines with tabs', () => {
      const raw = 'Constraint: First part\n\tsecond part';
      const result = parser.parse(raw);
      expect(result.Constraint).toEqual(['First part second part']);
    });

    it('should handle multiple continuation lines', () => {
      const raw = 'Key: v1\n  v2\n  v3';
      const result = parser.parse(raw);
      expect(result.Key).toEqual(['v1 v2 v3']);
    });

    it('should trim values', () => {
      const raw = 'Key:   value   ';
      const result = parser.parse(raw);
      expect(result.Key).toEqual(['value']);
    });

    it('should handle unicode in trailer values', () => {
      const raw = 'Constraint: Must support emoji \u{1F680} and CJK \u4E16\u754C';
      const result = parser.parse(raw);
      expect(result.Constraint).toEqual(['Must support emoji \u{1F680} and CJK \u4E16\u754C']);
    });

    it('should handle trailers with colons in the value', () => {
      const raw = 'Constraint: Time format: HH:MM:SS';
      const result = parser.parse(raw);
      expect(result.Constraint).toEqual(['Time format: HH:MM:SS']);
    });

    it('should skip blank lines between trailers', () => {
      const raw = 'K1: v1\n\nK2: v2';
      const result = parser.parse(raw);
      expect(result.K1).toEqual(['v1']);
      expect(result.K2).toEqual(['v2']);
    });
  });

  describe('serialize', () => {
    it('should serialize trailers', () => {
      const trailers = { Key: ['v1', 'v2'] };
      const result = parser.serialize(trailers);
      expect(result).toBe('Key: v1\nKey: v2');
    });

    it('should respect authorizedKeys order', () => {
      const trailers = { B: ['vb'], A: ['va'] };
      const result = parser.serialize(trailers, ['A', 'B']);
      expect(result).toBe('A: va\nB: vb');
    });

    it('should not serialize empty trailers', () => {
      const trailers = { Key: [] };
      const result = parser.serialize(trailers);
      expect(result).toBe('');
    });
  });

  describe('extractTrailerBlock', () => {
    it('should extract the last paragraph if it contains trailers', () => {
      const message = 'Subject\n\nBody\n\nKey: value';
      const result = parser.extractTrailerBlock(message);
      expect(result).toBe('Key: value');
    });

    it('should return empty if last paragraph has no trailers', () => {
      const message = 'Subject\n\nBody';
      const result = parser.extractTrailerBlock(message);
      expect(result).toBe('');
    });

    it('should handle complex trailer blocks with continuation lines', () => {
      const message = 'Subject\n\nKey: v1\n  v2\nOther: v3';
      const result = parser.extractTrailerBlock(message);
      expect(result).toBe('Key: v1\n  v2\nOther: v3');
    });
  });
});
