import { describe, expect,it } from 'vitest';

import { 
    createProtocolContext, 
    getAuthorizedKeys, 
    getFormattableDefinitions,
    getListKeys, 
    getReferenceKeys,
    getScalarKeys, 
    isCoreTrailer} from '../../../../src/engine/core/logic/protocols.js';

describe('Protocols Logic (Pure Functions)', () => {
  const definition = {
    name: 'Test',
    version: '1.0',
    identityKey: 'Test-id',
    strict: true,
    permissive: false,
    namespace: '',
    trailers: {
      'Test-id': { description: 'ID', multivalue: false, validation: 'none' as const, prompt: { order: 10 } },
      'Scalar': { description: 'S', multivalue: false, validation: 'none' as const, prompt: { order: 20 } },
      'List': { description: 'L', multivalue: true, validation: 'none' as const, prompt: { order: 30 } },
      'Ref': { description: 'R', multivalue: true, validation: 'reference' as const, prompt: { order: 40 } },
      'Core': { description: 'C', multivalue: false, validation: 'none' as const, isCore: true }
    }
  };

  const ctx = createProtocolContext(definition);

  it('createProtocolContext should correctly hydrate a context', () => {
    expect(ctx.name).toBe('test');
    expect(ctx.version).toBe('1.0');
    expect(ctx.isRoot).toBe(true);
    expect(ctx.caseMap.get('test-id')).toBe('Test-id');
  });

  it('getAuthorizedKeys should return keys in prompt order', () => {
      expect(getAuthorizedKeys(ctx)).toEqual(['Test-id', 'Scalar', 'List', 'Ref', 'Core']);
  });

  it('getAuthorizedKeys should default missing prompt orders to the end of the list (1000)', () => {
    const p = createProtocolContext({
        name: 'test',
        version: '1.0',
        identityKey: 'Id',
        strict: true,
        permissive: false,
        namespace: '',
        trailers: {
          'Last': { description: 'L', multivalue: false, validation: 'none' as const },
          'First': { description: 'F', multivalue: false, validation: 'none' as const, prompt: { order: 1 } }
        }
      });
      // Id has order 0 by default in createProtocolContext if not specified
      expect(getAuthorizedKeys(p)).toEqual(['Id', 'First', 'Last']);
  });

  it('getAuthorizedKeys should default custom trailers to the end of the sort order', () => {
    const p = createProtocolContext({ 
        name: 'OrderTest',
        version: '1.0',
        identityKey: 'id',
        strict: true,
        permissive: false,
        namespace: '',
        trailers: { 'Custom': { description: 'D', multivalue: false, validation: 'none' as const } }
    });
    const keys = getAuthorizedKeys(p);
    expect(keys[keys.length - 1]).toBe('Custom');
  });

  it('should mark a trailer as required if set in definitions', () => {
    const p = createProtocolContext({
      name: 'RequiredTest',
      version: '1.0',
      identityKey: 'id',
      strict: true,
      permissive: false,
      namespace: '',
      trailers: { 'Must-Have': { description: '', multivalue: false, validation: 'none' as const, required: true } }
    });
    expect(p.trailers.get('Must-Have')?.required).toBe(true);
  });

  it('getScalarKeys should return single-value keys only', () => {
      expect(getScalarKeys(ctx)).toContain('Scalar');
      expect(getScalarKeys(ctx)).not.toContain('List');
  });

  it('getListKeys should return multivalue keys only', () => {
      expect(getListKeys(ctx)).toContain('List');
      expect(getListKeys(ctx)).not.toContain('Scalar');
  });

  it('getReferenceKeys should return keys with reference validation', () => {
      expect(getReferenceKeys(ctx)).toEqual(['Ref']);
  });

  it('isCoreTrailer should identify core trailers', () => {
      expect(isCoreTrailer('Core', ctx)).toBe(true);
      expect(isCoreTrailer('Scalar', ctx)).toBe(false);
  });

  it('getFormattableDefinitions should transform definitions for UI', () => {
      const formattable = getFormattableDefinitions(ctx);
      expect(formattable['Scalar'].ui?.kind).toBe('text');
      expect(formattable['Scalar'].ui?.color).toBe('dim');
  });
});
