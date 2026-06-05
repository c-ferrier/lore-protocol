import { describe, it, expect } from 'vitest';
import { escapeRegex } from '../../../../src/engine/core/logic/regex.js';

describe('Regex Logic (Pure Functions)', () => {
  it('should escape regex special characters', () => {
    expect(escapeRegex('hello.world')).toBe('hello\\.world');
    expect(escapeRegex('main*')).toBe('main\\*');
  });

  it('should return empty string for empty input', () => {
    expect(escapeRegex('')).toBe('');
  });
});
