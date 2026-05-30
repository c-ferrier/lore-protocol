import { describe, it, expect } from 'vitest';
import { slugify, snakeCase, camelCase } from '../../../src/engine/util/string.js';

describe('String Utilities', () => {
  describe('slugify', () => {
    it('should convert spaces to hyphens and lowercase', () => {
      expect(slugify('My Trailer Key')).toBe('my-trailer-key');
    });

    it('should collapse multiple separators', () => {
      expect(slugify('My   Trailer--Key!!')).toBe('my-trailer-key');
    });

    it('should trim separators from ends', () => {
      expect(slugify('--my-key--')).toBe('my-key');
    });

    it('should support custom separators', () => {
      expect(slugify('My Key', '_')).toBe('my_key');
    });
  });

  describe('snakeCase', () => {
    it('should convert camelCase to snake_case', () => {
      expect(snakeCase('confidenceLevel')).toBe('confidence_level');
    });

    it('should convert PascalCase to snake_case', () => {
      expect(snakeCase('ConfidenceLevel')).toBe('confidence_level');
    });

    it('should convert kebab-case to snake_case', () => {
      expect(snakeCase('scope-risk')).toBe('scope_risk');
    });

    it('should handle spaces', () => {
      expect(snakeCase('My Trailer')).toBe('my_trailer');
    });

    it('should collapse multiple underscores and trim', () => {
      expect(snakeCase('__My--Trailer  Key__')).toBe('my_trailer_key');
    });
  });

  describe('camelCase', () => {
    it('should convert kebab-case to camelCase', () => {
      expect(camelCase('scope-risk')).toBe('scopeRisk');
    });

    it('should convert space-separated strings to camelCase', () => {
      expect(camelCase('Assisted by')).toBe('assistedBy');
    });

    it('should convert snake_case to camelCase', () => {
      expect(camelCase('my_trailer_key')).toBe('myTrailerKey');
    });

    it('should ensure the first character is lowercase', () => {
      expect(camelCase('Confidence')).toBe('confidence');
    });

    it('should handle complex mixed separators', () => {
      expect(camelCase('My-Trailer Key_Value')).toBe('myTrailerKeyValue');
    });
  });
});
