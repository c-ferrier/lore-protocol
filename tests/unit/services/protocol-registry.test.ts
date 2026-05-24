import { describe, it, expect, vi } from 'vitest';
import { ProtocolRegistry } from '../../../src/services/protocol-registry.js';
import type { IProtocol } from '../../../src/interfaces/protocol.js';

describe('ProtocolRegistry', () => {
  const createMockProtocol = (name: string, claimsValue = true): IProtocol => ({
    name,
    version: '1.0',
    namespace: '',
    identityKey: `${name}-id`,
    isPermissive: false,
    claims: vi.fn().mockReturnValue(claimsValue),
    getDiscoveryGrep: vi.fn().mockReturnValue([]),
    getDiscoveryPattern: vi.fn().mockReturnValue(`^${name}-id: [0-9a-f]{8}`),
    getSearchGrep: vi.fn().mockReturnValue([]),
    matches: vi.fn().mockReturnValue(true),
    authorize: vi.fn(),
    getDefinition: vi.fn(),
    getAuthorizedKeys: vi.fn(),
    getScalarKeys: vi.fn(),
    getListKeys: vi.fn(),
    getReferenceKeys: vi.fn(),
    isCore: vi.fn(),
    getUiKind: vi.fn(),
    getUiColor: vi.fn(),
    getFormattableDefinitions: vi.fn(),
    parse: vi.fn().mockReturnValue({ name, version: '1.0', identityKey: `${name}-id`, trailers: {} }),
    isValidIdentity: vi.fn(),
    owns: vi.fn(),
    getIdentityPattern: vi.fn().mockReturnValue(`^${name}-id: `),
  } as unknown as IProtocol);

  it('should register and retrieve protocols', () => {
    const registry = new ProtocolRegistry();
    const lore = createMockProtocol('Lore');
    
    registry.register(lore);
    
    expect(registry.get('Lore')).toBe(lore);
    expect(registry.get('lore')).toBe(lore); // Case-insensitive
    expect(registry.all()).toContain(lore);
  });

  it('should detect protocols that claim raw trailers', () => {
    const registry = new ProtocolRegistry();
    const lore = createMockProtocol('Lore', true);
    const fred = createMockProtocol('Fred', false);
    
    registry.register(lore);
    registry.register(fred);
    
    const detected = registry.detect('some trailers');
    expect(detected).toContain(lore);
    expect(detected).not.toContain(fred);
  });

  it('should aggregate discovery grep arguments from all protocols into a single OR statement', () => {
    const registry = new ProtocolRegistry();
    const lore = createMockProtocol('Lore');
    const fred = createMockProtocol('Fred');
    
    registry.register(lore);
    registry.register(fred);
    
    const greps = registry.getDiscoveryGrep();
    expect(greps).toHaveLength(1);
    expect(greps[0]).toContain('^Lore-id: [0-9a-f]{8}');
    expect(greps[0]).toContain('^Fred-id: [0-9a-f]{8}');
    expect(greps[0]).toContain('|');
    // Ensure grouping parentheses are present
    expect(greps[0]).toMatch(/\(\^Lore-id: \[0-9a-f\]\{8\}\)\|\(\^Fred-id: \[0-9a-f\]\{8\}\)/);
  });

  it('should throw an error if registering more than one permissive protocol in same namespace', () => {
    const registry = new ProtocolRegistry();
    
    const lore = createMockProtocol('Lore');
    Object.defineProperty(lore, 'isPermissive', { get: () => true });
    Object.defineProperty(lore, 'namespace', { get: () => '' });
    
    const fred = createMockProtocol('Fred');
    Object.defineProperty(fred, 'isPermissive', { get: () => true });
    Object.defineProperty(fred, 'namespace', { get: () => '' });
    
    registry.register(lore);
    expect(() => registry.register(fred)).toThrow(/A permissive protocol \("Lore"\) is already registered for namespace "root"/);
  });

  it('should allow multiple permissive protocols in DIFFERENT namespaces', () => {
    const registry = new ProtocolRegistry();
    
    const lore = createMockProtocol('Lore');
    Object.defineProperty(lore, 'isPermissive', { get: () => true });
    Object.defineProperty(lore, 'namespace', { get: () => '' });
    
    const fred = createMockProtocol('Fred');
    Object.defineProperty(fred, 'isPermissive', { get: () => true });
    Object.defineProperty(fred, 'namespace', { get: () => 'Fred' });
    
    registry.register(lore);
    expect(() => registry.register(fred)).not.toThrow();
    expect(registry.all()).toHaveLength(2);
  });

  it('should return empty array for discovery grep if no protocols registered', () => {
    const registry = new ProtocolRegistry();
    expect(registry.getDiscoveryGrep()).toEqual([]);
  });

  it('should treat namespace comparison as case-insensitive for safety rules', () => {
    const registry = new ProtocolRegistry();
    
    const lore = createMockProtocol('Lore');
    Object.defineProperty(lore, 'isPermissive', { get: () => true });
    Object.defineProperty(lore, 'namespace', { get: () => 'System' });
    
    const fred = createMockProtocol('Fred');
    Object.defineProperty(fred, 'isPermissive', { get: () => true });
    Object.defineProperty(fred, 'namespace', { get: () => 'system' }); // lowercase
    
    registry.register(lore);
    expect(() => registry.register(fred)).toThrow(/namespace "system"/);
  });

  it('should return the root protocol if registered', () => {
    const registry = new ProtocolRegistry();
    const lore = createMockProtocol('Lore');
    Object.defineProperty(lore, 'namespace', { get: () => '' });
    
    const fred = createMockProtocol('Fred');
    Object.defineProperty(fred, 'namespace', { get: () => 'Fred' });
    
    registry.register(fred);
    expect(registry.getRoot()).toBeUndefined();
    
    registry.register(lore);
    expect(registry.getRoot()).toBe(lore);
  });
});
