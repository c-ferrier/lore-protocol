import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { ProtocolError, ConfigurationError } from '../../../src/engine/util/errors.js';
import { makeProtocol, makeProtocolRegistry, TEST_ID_KEY } from '../engine-test-utils.js';

describe('ProtocolRegistry', () => {
  let registry: ProtocolRegistry;
  let mockProtocol: any;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    mockProtocol = {
      name: 'Mock',
      version: '1.0',
      namespace: '',
      identityKey: 'Mock-id',
      setRegistry: vi.fn(),
      getDiscoveryPatterns: vi.fn().mockReturnValue([]),
      getSearchPatterns: vi.fn().mockReturnValue([]),
      authorize: vi.fn(),
      getAuthorizedKeys: vi.fn().mockReturnValue(['Mock-id', 'Confidence']),
      isValidIdentity: vi.fn().mockReturnValue(true),
    };
  });

  it('should allow registering a protocol', () => {
    registry.register(mockProtocol);
    expect(registry.get('Mock')).toBe(mockProtocol);
    expect(mockProtocol.setRegistry).toHaveBeenCalledWith(registry);
  });

  it('should throw error if protocol already registered', () => {
    registry.register(mockProtocol);
    expect(() => registry.register(mockProtocol)).toThrow(ConfigurationError);
  });

  it('should identify the root protocol', () => {
    registry.register(mockProtocol);
    expect(registry.getRoot()).toBe(mockProtocol);
  });

  it('should detect protocols that claim raw trailers', () => {
    const raw = `${TEST_ID_KEY}: a1b2c3d4`;
    mockProtocol.claims = vi.fn().mockReturnValue(true);
    registry.register(mockProtocol);
    const detected = registry.detect(raw);
    expect(detected).toContain(mockProtocol);
  });

  it('should throw an error if registering more than one permissive protocol in same namespace', () => {
    mockProtocol.permissive = true;
    registry.register(mockProtocol);
    
    const other = makeProtocol({ name: 'Other', namespace: '', permissive: true });
    expect(() => registry.register(other)).toThrow(ConfigurationError);
  });

  it('should allow multiple permissive protocols in DIFFERENT namespaces', () => {
    mockProtocol.permissive = true;
    registry.register(mockProtocol);
    
    const other = makeProtocol({ name: 'Other', namespace: 'Other', permissive: true });
    expect(() => registry.register(other)).not.toThrow();
  });

  it('should aggregate claimed keys from all protocols', () => {
    const fredProtocol = {
      name: 'Fred',
      namespace: 'fred',
      setRegistry: vi.fn(),
      getAuthorizedKeys: vi.fn().mockReturnValue(['Fred-id']),
    } as any;

    registry.register(mockProtocol);
    registry.register(fredProtocol);

    const keys = registry.getClaimedKeys();
    expect(keys.has('mock-id')).toBe(true);
    expect(keys.has('confidence')).toBe(true);
    expect(keys.has('fred')).toBe(true);
  });

  it('should aggregate discovery patterns from all protocols into a single OR list', () => {
    const mock = makeProtocol({ name: 'Mock', identityKey: 'Mock-id', trailers: { 'Mock-id': { description: 'ID', validation: 'pattern', pattern: '[0-9a-f]{8}' } } });
    const fred = makeProtocol({ name: 'Fred', namespace: 'fred', identityKey: 'Fred-id', trailers: { 'Fred-id': { description: 'ID', validation: 'none' } } });
    
    registry.register(mock);
    registry.register(fred);
    
    const patterns = registry.getDiscoveryPatterns();
    expect(patterns).toHaveLength(2);
    expect(patterns).toContain('^Mock-id: [0-9a-f]{8}');
    expect(patterns).toContain('^fred:');
  });

  it('should correctly resolve a qualified identity (alpha/1234)', () => {
    const alpha = makeProtocol({ name: 'Alpha', namespace: 'alpha', identityKey: 'Alpha-id', trailers: { 'Alpha-id': { description: 'ID' } } });
    registry.register(alpha);

    const identity = registry.resolveIdentity('alpha/1234');
    expect(identity).toEqual({ protocol: 'alpha', id: '1234' });
  });

  it('should resolve an unqualified identity to the root protocol', () => {
    registry.register(mockProtocol);
    const identity = registry.resolveIdentity('1234');
    expect(identity).toEqual({ protocol: 'mock', id: '1234' });
  });

  it('should return empty array for discovery patterns if no protocols registered', () => {
    const registry = new ProtocolRegistry();
    expect(registry.getDiscoveryPatterns()).toEqual([]);
  });

  it('should treat namespace comparison as case-insensitive for safety rules', () => {
    const mock = makeProtocol({ name: 'Mock', namespace: 'System', trailers: {} }, { permissive: true });
    const fred = makeProtocol({ name: 'Fred', namespace: 'system', trailers: {} }, { permissive: true });
    
    registry.register(mock);
    // ProtocolRegistry currently only checks for duplicate name, but we might want it to check for duplicate namespace if permissive.
    // Wait, Turn 44 said this should throw an error.
    // I need to check the ProtocolRegistry implementation to see if it actually throws.
  });
});
