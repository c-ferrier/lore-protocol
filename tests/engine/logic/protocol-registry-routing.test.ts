import { describe, it, expect, vi } from 'vitest';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { ProtocolError } from '../../../src/engine/util/errors.js';
import { makeMockProtocol } from '../engine-test-utils.js';

describe('ProtocolRegistry Key Routing', () => {
  it('should resolve a unique owner for a key', () => {
    const p1 = makeMockProtocol({ name: 'P1', authorize: (k: string) => k === 'Key1' ? 'Key1' : null });
    const p2 = makeMockProtocol({ name: 'P2', authorize: (k: string) => k === 'Key2' ? 'Key2' : null });
    const registry = new ProtocolRegistry();
    registry.register(p1);
    registry.register(p2);

    expect(registry.resolveKey('Key1')).toBe(p1);
    expect(registry.resolveKey('Key2')).toBe(p2);
  });

  it('should throw an error if multiple protocols own the same key', () => {
    const p1 = makeMockProtocol({ name: 'P1', authorize: (k: string) => k === 'Status' ? 'Status' : null });
    const p2 = makeMockProtocol({ name: 'P2', authorize: (k: string) => k === 'Status' ? 'Status' : null });
    const registry = new ProtocolRegistry();
    registry.register(p1);
    registry.register(p2);

    expect(() => registry.resolveKey('Status')).toThrow(ProtocolError);
    expect(() => registry.resolveKey('Status')).toThrow(/Ambiguous key "Status" is owned by multiple protocols/);
  });

  it('should return undefined if no protocol owns the key', () => {
    const p1 = makeMockProtocol({ name: 'P1', authorize: () => null });
    const registry = new ProtocolRegistry();
    registry.register(p1);

    expect(registry.resolveKey('Unknown')).toBeUndefined();
  });

  it('should be case-insensitive when checking ownership', () => {
    const p = makeMockProtocol({
        name: 'P1',
        authorize: (k: string) => k.toLowerCase() === 'status' ? 'Status' : null,
    });
    const registry = new ProtocolRegistry();
    registry.register(p);

    expect(registry.resolveKey('status')).toBe(p);
    expect(registry.resolveKey('STATUS')).toBe(p);
  });
});
