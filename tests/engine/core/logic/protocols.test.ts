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
    trailers: {
      'Test-id': { description: 'ID', prompt: { order: 10 } },
      'Scalar': { description: 'S', multivalue: false, prompt: { order: 20 } },
      'List': { description: 'L', multivalue: true, prompt: { order: 30 } },
      'Ref': { description: 'R', validation: 'reference' as const, prompt: { order: 40 } },
      'Core': { description: 'C', isCore: true } as any
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
        identityKey: 'Id',
        trailers: {
          'Last': { description: 'L' },
          'First': { description: 'F', prompt: { order: 1 } }
        }
      } as any);
      // Id has order 0 by default in createProtocolContext if not specified
      expect(getAuthorizedKeys(p)).toEqual(['Id', 'First', 'Last']);
  });

  it('getAuthorizedKeys should default custom trailers to the end of the sort order', () => {
    const p = createProtocolContext({ 
        name: 'OrderTest',
        identityKey: 'id',
        trailers: { 'Custom': { description: 'D' } }
    } as any);
    const keys = getAuthorizedKeys(p);
    expect(keys[keys.length - 1]).toBe('Custom');
  });

  it('should mark a trailer as required if set in definitions', () => {
    const p = createProtocolContext({
      name: 'RequiredTest',
      identityKey: 'id',
      trailers: { 'Must-Have': { description: '', required: true } }
    } as any);
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
      expect(formattable['Scalar'].ui.kind).toBe('text');
      expect(formattable['Scalar'].ui.color).toBe('dim');
  });
});
