import { describe, it, expect } from 'vitest';
import { 
    createProtocolContext, 
    getAuthorizedKeys, 
    getScalarKeys, 
    getListKeys, 
    getReferenceKeys,
    isCoreTrailer,
    getFormattableDefinitions
} from '../../../../src/engine/core/logic/protocols.js';

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
