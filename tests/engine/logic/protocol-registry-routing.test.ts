import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { makeMockProtocolContext } from '../engine-test-utils.js';

import { describe, it, expect } from 'vitest';

describe('ProtocolRegistry Key Routing', () => {
  it('should resolve a unique owner for a key', () => {
    // P1 is root
    const p1 = makeMockProtocolContext({ 
        name: 'P1', 
        namespace: '',
        authorize: (k: string) => k === 'Key1' ? 'Key1' : null 
    });
    // P2 is namespaced
    const p2 = makeMockProtocolContext({ 
        name: 'P2', 
        namespace: 'ns2',
        authorize: (k: string) => k === 'ns2' ? 'ns2' : null 
    });
    const registry = new ProtocolRegistry();
    registry.register(p1);
    registry.register(p2);

    expect(registry.resolveKey('Key1')).toBe(p1);
    expect(registry.resolveKey('ns2')).toBe(p2);
  });

  it('should return the root protocol as fallback for unknown keys', () => {
    const p1 = makeMockProtocolContext({ name: 'Root', namespace: '' });
    const registry = new ProtocolRegistry();
    registry.register(p1);

    expect(registry.resolveKey('Unknown')).toBe(p1);
  });

  it('should return undefined if no protocol owns the key and no root exists', () => {
      const p1 = makeMockProtocolContext({ name: 'NS', namespace: 'ns' });
      const registry = new ProtocolRegistry();
      registry.register(p1);

      expect(registry.resolveKey('Unknown')).toBeUndefined();
  });

  it('should be case-insensitive when checking ownership', () => {
    const p = makeMockProtocolContext({
        name: 'P1',
        namespace: '',
        authorize: (k: string) => k.toLowerCase() === 'status' ? 'Status' : null,
    });
    const registry = new ProtocolRegistry();
    registry.register(p);

    expect(registry.resolveKey('status')).toBe(p);
    expect(registry.resolveKey('STATUS')).toBe(p);
  });
});
