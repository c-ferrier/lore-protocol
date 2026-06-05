import { describe, expect,it } from 'vitest';

import { authorizeKey } from '../../../../src/engine/core/logic/ownership.js';
import { 
    getAuthorizedKeys, 
    getFormattableDefinitions,
    getListKeys, 
    getReferenceKeys,
    getScalarKeys, 
    isCoreTrailer} from '../../../../src/engine/core/logic/protocols.js';
import { type ActiveTrailer } from '../../../../src/engine/core/models/active-protocol.js';
import { makeMockContext } from '../../../../src/engine/testing.js';

describe('Protocol Schema Logic (via Context)', () => {
  const createSchema = (definitions: Map<string, ActiveTrailer>, permissive = true) => {
    const trailers: any = {};
    for (const [key, def] of definitions.entries()) {
        trailers[key] = def;
    }
    return makeMockContext({
        name: 'Schema',
        trailers,
        permissive,
        strict: !permissive
    });
  };

  it('should authorize registered keys case-insensitively', () => {
    const definitions = new Map<string, ActiveTrailer>([
      ['Confidence', { key: 'Confidence', description: '', multivalue: false }]
    ]);
    const schema = createSchema(definitions);

    expect(authorizeKey('confidence', schema)).toBe('Confidence');
    expect(authorizeKey('CONFIDENCE', schema)).toBe('Confidence');
    expect(authorizeKey('Confidence', schema)).toBe('Confidence');
  });

  it('should authorize unknown keys in permissive mode', () => {
    const schema = createSchema(new Map(), true);
    expect(authorizeKey('Random-Key', schema)).toBe('Random-Key');
  });

  it('should not authorize unknown keys in strict mode', () => {
    const schema = createSchema(new Map(), false);
    expect(authorizeKey('Random-Key', schema)).toBeNull();
  });

  it('should identify core trailers correctly', () => {
    const definitions = new Map<string, ActiveTrailer>([
      ['Core-Key', { key: 'Core-Key', description: '', multivalue: false, isCore: true }],
      ['Custom-Key', { key: 'Custom-Key', description: '', multivalue: false, isCore: false }]
    ]);
    const schema = createSchema(definitions);

    expect(isCoreTrailer('Core-Key', schema)).toBe(true);
    expect(isCoreTrailer('Custom-Key', schema)).toBe(false);
    expect(isCoreTrailer('Unknown', schema)).toBe(false);
  });

  it('should sort authorized keys based on prompt order', () => {
    const definitions = new Map<string, ActiveTrailer>([
      ['Last', { key: 'Last', description: '', multivalue: false, prompt: { order: 100 } }],
      ['First', { key: 'First', description: '', multivalue: false, prompt: { order: 10 } }],
      ['Middle', { key: 'Middle', description: '', multivalue: false, prompt: { order: 50 } }]
    ]);
    const schema = createSchema(definitions);

    // Mock-id has order 0 by default in makeMockContext/makeProtocolDefinition
    expect(getAuthorizedKeys(schema)).toEqual(['Mock-id', 'First', 'Middle', 'Last']);
  });

  it('should return semantic UI metadata', () => {
    const definitions = new Map<string, ActiveTrailer>([
      ['Identity', { key: 'Identity', description: '', multivalue: false, ui: { kind: 'identity', color: 'dim' } }],
      ['Default', { key: 'Default', description: '', multivalue: false }]
    ]);
    const schema = createSchema(definitions);

    const formattable = getFormattableDefinitions(schema);
    expect(formattable['Identity'].ui?.kind).toBe('identity');
    expect(formattable['Identity'].ui?.color).toBe('dim');
    expect(formattable['Default'].ui?.kind).toBe('text'); // default
    expect(formattable['Default'].ui?.color).toBe('dim'); // default
  });

  it('should categorise keys by type', () => {
    const definitions = new Map<string, ActiveTrailer>([
        ['Scalar', { key: 'Scalar', description: '', multivalue: false }],
        ['List', { key: 'List', description: '', multivalue: true }],
        ['Ref', { key: 'Ref', description: '', multivalue: false, validation: 'reference' }]
    ]);
    const schema = createSchema(definitions);

    expect(getScalarKeys(schema)).toContain('Scalar');
    expect(getScalarKeys(schema)).toContain('Ref');
    expect(getListKeys(schema)).toContain('List');
    expect(getReferenceKeys(schema)).toContain('Ref');
  });

  it('should handle empty definitions gracefully', () => {
    const schema = createSchema(new Map(), false);
    // Should still have identity key
    expect(getAuthorizedKeys(schema)).toEqual(['Mock-id']);
  });

  it('should default missing prompt orders to the end of the list (1000)', () => {
    const definitions = new Map<string, ActiveTrailer>([
      ['Last', { key: 'Last', description: '', multivalue: false }],
      ['First', { key: 'First', description: '', multivalue: false, prompt: { order: 1 } }]
    ]);
    const schema = createSchema(definitions);

    expect(getAuthorizedKeys(schema)).toEqual(['Mock-id', 'First', 'Last']);
  });
});
