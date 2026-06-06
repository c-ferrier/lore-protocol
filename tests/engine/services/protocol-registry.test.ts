import { GLOBAL_NAMESPACE } from '../../../src/engine/util/constants.js';
import { beforeEach,describe, expect, it } from 'vitest';

import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { makeProtocol } from '../../../src/engine/testing.js';
import { ConfigurationError } from '../../../src/engine/util/errors.js';
import { makeMockProtocolContext } from '../engine-test-utils.js';

describe('ProtocolRegistry', () => {
  let registry: ProtocolRegistry;

  beforeEach(() => {
    registry = new ProtocolRegistry();
  });

  it('should allow registering a protocol', () => {
    const protocol = makeProtocol({ name: 'RegistryMock' });
    registry.register(protocol);
    expect(registry.get('RegistryMock')).toBe(protocol);
  });

  it('should throw error if protocol already registered', () => {
    const protocol = makeProtocol({ name: 'RegistryMock' });
    registry.register(protocol);
    expect(() => registry.register(protocol)).toThrow(ConfigurationError);
  });

  it('should identify the root protocol', () => {
    const root = makeProtocol({ name: 'Root', namespace: '' });
    const other = makeProtocol({ name: 'Other', namespace: 'other' });
    
    registry.register(other);
    expect(registry.getByNamespace(GLOBAL_NAMESPACE)).toBeUndefined();
    
    registry.register(root);
    expect(registry.getByNamespace(GLOBAL_NAMESPACE)).toBe(root);
  });

  it('should detect protocols that claim raw trailers', () => {
    const protocol = makeProtocol({ name: 'Mock', identityKey: 'Mock-id' });
    const raw = `Mock-id: a1b2c3d4`;
    registry.register(protocol);
    const detected = registry.detect(raw);
    expect(detected).toContain(protocol);
  });

  it('should throw an error if registering more than one permissive protocol in same namespace', () => {
    const p1 = makeProtocol({ name: 'P1', namespace: '' }, { permissive: true });
    registry.register(p1);
    
    const other = makeProtocol({ name: 'Other', namespace: '' }, { permissive: true });
    expect(() => registry.register(other)).toThrow(ConfigurationError);
  });

  it('should aggregate claimed keys from all protocols', () => {
    const p1 = makeProtocol({
      name: 'P1',
      trailers: { 'Key1': { description: 'D' } }
    });
    const p2 = makeProtocol({
      name: 'P2',
      namespace: 'ns',
      trailers: { 'Key2': { description: 'D' } }
    });

    registry.register(p1);
    registry.register(p2);

    const keys = registry.getClaimedKeys();
    expect(keys.has('key1')).toBe(true);
    expect(keys.has('key2')).toBe(false); // Key2 is isolated in 'ns' bucket
    expect(keys.has('ns')).toBe(true); // Namespace is claimed
  });

  it('should correctly resolve a qualified identity (alpha/1234)', () => {
    const alpha = makeProtocol({ name: 'Alpha', namespace: 'alpha' });
    registry.register(alpha);

    const identity = registry.resolveIdentity('alpha/1234');
    expect(identity).toEqual({ protocol: 'alpha', id: '1234' });
  });

  it('should resolve an unqualified identity to the root protocol', () => {
    const root = makeProtocol({ name: 'Root', namespace: '' });
    registry.register(root);
    const identity = registry.resolveIdentity('1234');
    expect(identity).toEqual({ protocol: 'root', id: '1234' });
  });

  it('should treat namespace comparison as case-insensitive for safety rules', () => {
    const mock = makeProtocol({ name: 'CaseMock', namespace: 'System' });
    const fred = makeProtocol({ name: 'CaseFred', namespace: 'system' });
    
    registry.register(mock);
    expect(() => registry.register(fred)).toThrow(ConfigurationError);
  });

  it('should allow multiple permissive protocols in DIFFERENT namespaces', () => {
    const p1 = makeProtocol({ name: 'P1', namespace: '' }, { permissive: true });
    registry.register(p1);
    
    const other = makeProtocol({ name: 'Other', namespace: 'Other', permissive: true });
    expect(() => registry.register(other)).not.toThrow();
  });

  it('should aggregate discovery patterns from all protocols into a single OR list', () => {
    const mock = makeProtocol({ name: 'Mock', identityKey: 'Mock-id', trailers: { 'Mock-id': { description: 'ID', validation: 'pattern', pattern: '[0-9a-f]{8}' } } });
    const fred = makeProtocol({ name: 'Fred', namespace: 'fred', identityKey: 'Fred-id' });
    
    registry.register(mock);
    registry.register(fred);
    
    const patterns = registry.getDiscoveryPatterns();
    expect(patterns).toHaveLength(2);
    expect(patterns).toContain('^Mock-id: [0-9a-f]{8}');
    expect(patterns).toContain('^fred:');
  });

  it('should return empty array for discovery patterns if no protocols registered', () => {
    const emptyRegistry = new ProtocolRegistry();
    expect(emptyRegistry.getDiscoveryPatterns()).toEqual([]);
  });

  it('should find protocols by namespace', () => {
    const p1 = makeProtocol({
     name: 'P1',
     namespace: 'n1',
   });
   
   registry.register(p1);
   expect(registry.getByNamespace(GLOBAL_NAMESPACE)).toBeUndefined();
   
   const p2 = makeProtocol({
     name: 'P2',
     namespace: '',
   });
   
   registry.register(p2);
   expect(registry.getByNamespace(GLOBAL_NAMESPACE)).toBe(p2);
  });

  describe('Key Routing', () => {
    it('should resolve a unique owner for a key', () => {
      const p1 = makeMockProtocolContext({ 
          name: 'P1', 
          namespace: '',
          trailers: { 'Key1': { description: 'K1' } } as any
      });
      const p2 = makeMockProtocolContext({ 
          name: 'P2', 
          namespace: 'ns2'
      });
      registry.register(p1 as any);
      registry.register(p2 as any);
  
      expect(registry.resolveKey('Key1')).toBe(p1);
      expect(registry.resolveKey('ns2')).toBe(p2);
    });
  
    it('should return the root protocol as fallback for unknown keys', () => {
      const p1 = makeMockProtocolContext({ name: 'Root', namespace: '' });
      registry.register(p1 as any);
  
      expect(registry.resolveKey('Unknown')).toBe(p1);
    });
  
    it('should return undefined if no protocol owns the key and no root exists', () => {
        const p1 = makeMockProtocolContext({ name: 'NS', namespace: 'ns' });
        registry.register(p1 as any);
  
        expect(registry.resolveKey('Unknown')).toBeUndefined();
    });
  
    it('should be case-insensitive when checking ownership', () => {
      const p = makeMockProtocolContext({
          name: 'P1',
          namespace: '',
          trailers: { 'Status': { description: 'S' } } as any
      });
      registry.register(p as any);
  
      expect(registry.resolveKey('status')).toBe(p);
      expect(registry.resolveKey('STATUS')).toBe(p);
    });
  });
});
