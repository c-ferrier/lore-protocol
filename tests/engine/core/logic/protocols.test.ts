import { describe, expect, it } from 'vitest';

import { 
    createProtocolContext,
    getAuthorizedKeys,
    getClaimedProtocolKeys, 
    getFormattableDefinitions,
    getListKeys,
    getReferenceKeys,
    getScalarKeys,
    isCoreTrailer,
    resolveProtocolIdentity, 
    resolveProtocolKey} from '../../../../src/engine/core/logic/protocols.js';
import { makeStubProtocolContext, makeStubProtocolMap } from '../../../../src/engine/testing.js';

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
      expect(formattable['Scalar'].ui?.kind).toBe('custom');
      expect(formattable['Scalar'].ui?.color).toBe('dim');
  });

  it('should aggregate claimed keys from all protocols', () => {
    const p1 = makeStubProtocolContext({
      name: 'P1',
      trailers: { 'Key1': { description: 'D', multivalue: false, validation: 'none' as const } }
    });
    const p2 = makeStubProtocolContext({
      name: 'P2',
      namespace: 'ns',
      trailers: { 'Key2': { description: 'D', multivalue: false, validation: 'none' as const } }
    });

    const protocols = makeStubProtocolMap([p1, p2]);

    const keys = getClaimedProtocolKeys(protocols);
    expect(keys.has('key1')).toBe(true);
    expect(keys.has('key2')).toBe(false); // Key2 is isolated in 'ns' bucket
    expect(keys.has('ns')).toBe(true); // Namespace is claimed
  });

  it('should correctly resolve a qualified identity (alpha/1234)', () => {
    const alpha = makeStubProtocolContext({ name: 'Alpha', namespace: 'alpha' });
    const protocols = makeStubProtocolMap([alpha]);

    const identity = resolveProtocolIdentity(protocols, 'alpha/1234');
    expect(identity).toEqual({ protocol: 'alpha', id: '1234' });
  });

  it('should resolve an unqualified identity to the root protocol', () => {
    const root = makeStubProtocolContext({ name: 'Root', namespace: '' });
    const protocols = makeStubProtocolMap([root]);
    
    const identity = resolveProtocolIdentity(protocols, '1234');
    expect(identity).toEqual({ protocol: 'root', id: '1234' });
  });

  describe('resolveProtocolKey', () => {
    it('should resolve a unique owner for a key', () => {
      const p1 = makeStubProtocolContext({ 
          name: 'P1', 
          namespace: '',
          trailers: { 'Key1': { description: 'K1', multivalue: false, validation: 'none' as const } }
      });
      const p2 = makeStubProtocolContext({ 
          name: 'P2', 
          namespace: 'ns2'
      });
      const protocols = makeStubProtocolMap([p1, p2]);
  
      expect(resolveProtocolKey(protocols, 'Key1')).toBe(p1);
      expect(resolveProtocolKey(protocols, 'ns2')).toBe(p2);
    });
  
    it('should return the root protocol as fallback for unknown keys', () => {
      const p1 = makeStubProtocolContext({ name: 'Root', namespace: '' });
      const protocols = makeStubProtocolMap([p1]);
  
      expect(resolveProtocolKey(protocols, 'Unknown')).toBe(p1);
    });
  
    it('should return undefined if no protocol owns the key and no root exists', () => {
        const p1 = makeStubProtocolContext({ name: 'NS', namespace: 'ns' });
        const protocols = makeStubProtocolMap([p1]);
  
        expect(resolveProtocolKey(protocols, 'Unknown')).toBeUndefined();
    });
  
    it('should be case-insensitive when checking ownership', () => {
      const p = makeStubProtocolContext({
          name: 'P1',
          namespace: '',
          trailers: { 'Status': { description: 'S', multivalue: false, validation: 'none' as const } }
      });
      const protocols = makeStubProtocolMap([p]);
  
      expect(resolveProtocolKey(protocols, 'status')).toBe(p);
      expect(resolveProtocolKey(protocols, 'STATUS')).toBe(p);
    });
  });
});
