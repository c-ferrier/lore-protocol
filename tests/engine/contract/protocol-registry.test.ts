import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { TEST_ID_KEY, makeMockContext } from '../../../src/engine/testing.js';
import { ConfigurationError } from '../../../src/engine/util/errors.js';
import { makeMockProtocolContext } from '../engine-test-utils.js';

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ProtocolRegistry', () => {
  let registry: ProtocolRegistry;
  let mockProtocol: any;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    mockProtocol = makeMockProtocolContext({
      name: 'RegistryMock',
      namespace: '',
      identityKey: 'Mock-id',
      trailers: {
          'Mock-id': { description: 'ID' },
          'Confidence': { description: 'C' }
      } as any,
      isValidIdentity: vi.fn().mockReturnValue(true),
    });
  });

  it('should allow registering a protocol', () => {
    registry.register(mockProtocol);
    expect(registry.get('RegistryMock')).toBe(mockProtocol);
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
    // Inject mock hook directly into the context object
    mockProtocol.claims = vi.fn().mockReturnValue(true);
    registry.register(mockProtocol);
    const detected = registry.detect(raw);
    expect(detected).toContain(mockProtocol);
  });

  it('should throw an error if registering more than one permissive protocol in same namespace', () => {
    mockProtocol.permissive = true;
    registry.register(mockProtocol);
    
    const other = makeMockContext({ name: 'OtherPermissive', namespace: '', permissive: true });
    expect(() => registry.register(other)).toThrow(ConfigurationError);
  });

  it('should allow multiple permissive protocols in DIFFERENT namespaces', () => {
    mockProtocol.permissive = true;
    registry.register(mockProtocol);
    
    const other = makeMockContext({ name: 'OtherPermissiveNS', namespace: 'Other', permissive: true });
    expect(() => registry.register(other)).not.toThrow();
  });

  it('should aggregate claimed keys from all protocols', () => {
    const fredProtocol = makeMockProtocolContext({
      name: 'FredClaim',
      namespace: 'fred',
      identityKey: 'fred',
      trailers: { 'fred': { description: 'ID' } } as any
    });

    registry.register(mockProtocol);
    registry.register(fredProtocol);

    const keys = registry.getClaimedKeys();
    expect(keys.has('mock-id')).toBe(true);
    expect(keys.has('confidence')).toBe(true);
    expect(keys.has('fred')).toBe(true);
  });

  it('should aggregate discovery patterns from all protocols into a single OR list', () => {
    const mock = makeMockContext({ name: 'DiscoveryMock', identityKey: 'Mock-id', trailers: { 'Mock-id': { description: 'ID', validation: 'pattern', pattern: '[0-9a-f]{8}' } } });
    const fred = makeMockContext({ name: 'DiscoveryFred', namespace: 'fred', identityKey: 'Fred-id', trailers: { 'Fred-id': { description: 'ID', validation: 'none' } } });
    
    registry.register(mock);
    registry.register(fred);
    
    const patterns = registry.getDiscoveryPatterns();
    expect(patterns).toHaveLength(2);
    expect(patterns).toContain('^Mock-id: [0-9a-f]{8}');
    expect(patterns).toContain('^fred:');
  });

  it('should correctly resolve a qualified identity (alpha/1234)', () => {
    const alpha = makeMockContext({ name: 'AlphaRes', namespace: 'alpha', identityKey: 'Alpha-id', trailers: { 'Alpha-id': { description: 'ID' } } });
    registry.register(alpha);

    const identity = registry.resolveIdentity('alpha/1234');
    expect(identity).toEqual({ protocol: 'alphares', id: '1234' });
  });

  it('should resolve an unqualified identity to the root protocol', () => {
    registry.register(mockProtocol);
    const identity = registry.resolveIdentity('1234');
    expect(identity).toEqual({ protocol: 'registrymock', id: '1234' });
  });

  it('should return empty array for discovery patterns if no protocols registered', () => {
    const registry = new ProtocolRegistry();
    expect(registry.getDiscoveryPatterns()).toEqual([]);
  });

  it('should treat namespace comparison as case-insensitive for safety rules', () => {
    const mock = makeMockContext({ name: 'CaseMock', namespace: 'System' });
    const fred = makeMockContext({ name: 'CaseFred', namespace: 'system' });
    
    registry.register(mock);
    expect(() => registry.register(fred)).toThrow(ConfigurationError);
  });
});
