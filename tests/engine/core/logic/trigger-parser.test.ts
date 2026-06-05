import { TriggerParser, parseTriggerHints } from '../../../../src/engine/core/logic/trigger-parser.js';
import { describe, it, expect } from 'vitest';

describe('TriggerParser (Logic)', () => {
  it('should parse simple trigger blocks', () => {
    const raw = '[key: val] instruction';
    const result = TriggerParser.parse(raw);
    expect(result.triggers).toHaveLength(1);
    expect(result.triggers[0]).toEqual({ key: 'key', value: 'val' });
    expect(result.instruction).toBe('instruction');
  });

  it('should parse multiple triggers', () => {
    const raw = '[k1: v1] [k2: v2] instruction';
    const result = TriggerParser.parse(raw);
    expect(result.triggers).toHaveLength(2);
    expect(result.instruction).toBe('instruction');
  });

  describe('parseTriggerHints', () => {
    it('should parse until hint', () => {
        const hints = parseTriggerHints('[until:2026-06-05] Remove this');
        expect(hints.until).toBeDefined();
        expect(hints.until?.getFullYear()).toBe(2026);
    });
  });
});
