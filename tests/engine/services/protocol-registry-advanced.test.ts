import { beforeEach,describe, expect, it } from 'vitest';

import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { makeProtocol } from '../../../src/engine/testing.js';
;
;

describe('ProtocolRegistry Advanced', () => {
  let registry: ProtocolRegistry;

  beforeEach(() => {
    registry = new ProtocolRegistry();
  });

  it('should generate correct aggregated discovery patterns for multiple protocols', () => {
    const p1 = makeProtocol({
      name: 'P1',
      identityKey: 'P1-id',
      trailers: { 'P1-id': { description: 'ID', validation: 'pattern', pattern: '[0-9]+' } }
    });
    const p2 = makeProtocol({
      name: 'P2',
      namespace: 'ns',
      identityKey: 'P2-id',
      trailers: { 'P2-id': { description: 'ID', validation: 'none' } }
    });

    registry.register(p1);
    registry.register(p2);

    const patterns = registry.getDiscoveryPatterns();
    expect(patterns).toHaveLength(2);
    expect(patterns).toContain('^P1-id: [0-9]+');
    expect(patterns).toContain('^ns:');
  });

  it('should return empty array if no protocols are registered', () => {
    expect(registry.getDiscoveryPatterns()).toEqual([]);
  });

  it('should find protocols by namespace', () => {
    const p1 = makeProtocol({
     name: 'P1',
     namespace: 'n1',
     trailers: {}
   });
   
   registry.register(p1);
   expect(registry.getRoot()).toBeUndefined();
   
   const p2 = makeProtocol({
     name: 'P2',
     namespace: '',
     trailers: {}
   });
   
   registry.register(p2);
   expect(registry.getRoot()).toBe(p2);
 });
});