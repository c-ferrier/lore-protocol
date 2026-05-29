import { describe, it, expect } from 'vitest';
import { ProtocolSchema } from '../../../../../src/engine/services/protocol/protocol-schema.js';
import type { ActiveTrailer } from '../../../../../src/engine/interfaces/protocol.js';

describe('ProtocolSchema', () => {
  const createSchema = (definitions: Map<string, ActiveTrailer>, permissive = true) => {
    const caseMap = new Map<string, string>();
    for (const key of definitions.keys()) {
      caseMap.set(key.toLowerCase(), key);
    }
    return new ProtocolSchema(definitions, caseMap, permissive);
  };

  it('should authorize registered keys case-insensitively', () => {
    const definitions = new Map<string, ActiveTrailer>([
      ['Confidence', { key: 'Confidence', description: '', multivalue: false }]
    ]);
    const schema = createSchema(definitions);

    expect(schema.authorize('confidence')).toBe('Confidence');
    expect(schema.authorize('CONFIDENCE')).toBe('Confidence');
    expect(schema.authorize('Confidence')).toBe('Confidence');
  });

  it('should authorize unknown keys in permissive mode', () => {
    const schema = createSchema(new Map(), true);
    expect(schema.authorize('Random-Key')).toBe('Random-Key');
  });

  it('should not authorize unknown keys in strict mode', () => {
    const schema = createSchema(new Map(), false);
    expect(schema.authorize('Random-Key')).toBeNull();
  });

  it('should identify core trailers correctly', () => {
    const definitions = new Map<string, ActiveTrailer>([
      ['Core-Key', { key: 'Core-Key', description: '', multivalue: false, isCore: true }],
      ['Custom-Key', { key: 'Custom-Key', description: '', multivalue: false, isCore: false }]
    ]);
    const schema = createSchema(definitions);

    expect(schema.isCore('Core-Key')).toBe(true);
    expect(schema.isCore('Custom-Key')).toBe(false);
    expect(schema.isCore('Unknown')).toBe(false);
  });

  it('should sort authorized keys based on prompt order', () => {
    const definitions = new Map<string, ActiveTrailer>([
      ['Last', { key: 'Last', description: '', multivalue: false, prompt: { order: 100 } }],
      ['First', { key: 'First', description: '', multivalue: false, prompt: { order: 10 } }],
      ['Middle', { key: 'Middle', description: '', multivalue: false, prompt: { order: 50 } }]
    ]);
    const schema = createSchema(definitions);

    expect(schema.getAuthorizedKeys()).toEqual(['First', 'Middle', 'Last']);
  });

  it('should return semantic UI metadata', () => {
    const definitions = new Map<string, ActiveTrailer>([
      ['Identity', { key: 'Identity', description: '', multivalue: false, ui: { kind: 'identity', color: 'dim' } }],
      ['Default', { key: 'Default', description: '', multivalue: false }]
    ]);
    const schema = createSchema(definitions);

    expect(schema.getUiKind('Identity')).toBe('identity');
    expect(schema.getUiColor('Identity')).toBe('dim');
    expect(schema.getUiKind('Default')).toBe('custom');
    expect(schema.getUiColor('Default')).toBe('cyan');
  });

  it('should categorise keys by type', () => {
    const definitions = new Map<string, ActiveTrailer>([
        ['Scalar', { key: 'Scalar', description: '', multivalue: false }],
        ['List', { key: 'List', description: '', multivalue: true }],
        ['Ref', { key: 'Ref', description: '', multivalue: false, validation: 'reference' }]
    ]);
    const schema = createSchema(definitions);

    expect(schema.getScalarKeys()).toContain('Scalar');
    expect(schema.getScalarKeys()).toContain('Ref');
    expect(schema.getListKeys()).toContain('List');
    expect(schema.getReferenceKeys()).toContain('Ref');
  });

  it('should handle empty definitions gracefully', () => {
    const schema = createSchema(new Map(), false);
    expect(schema.getAuthorizedKeys()).toEqual([]);
    expect(schema.getScalarKeys()).toEqual([]);
    expect(schema.getFormattableDefinitions()).toEqual({});
  });

  it('should default missing prompt orders to the end of the list (1000)', () => {
    const definitions = new Map<string, ActiveTrailer>([
      ['Last', { key: 'Last', description: '', multivalue: false }],
      ['First', { key: 'First', description: '', multivalue: false, prompt: { order: 1 } }]
    ]);
    const schema = createSchema(definitions);

    expect(schema.getAuthorizedKeys()).toEqual(['First', 'Last']);
  });
});
