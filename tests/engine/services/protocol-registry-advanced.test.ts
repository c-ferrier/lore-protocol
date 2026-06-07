import { beforeEach,describe, expect, it } from 'vitest';

import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { makeStubProtocolContext } from '../../../src/engine/testing.js';
import { GLOBAL_NAMESPACE } from '../../../src/engine/util/constants.js';
;
;

describe('ProtocolRegistry Advanced', () => {
  let registry: ProtocolRegistry;

  beforeEach(() => {
    registry = new ProtocolRegistry();
  });

  it('should generate correct aggregated discovery patterns for multiple protocols', () => {
    const p1 = makeStubProtocolContext({
      name: 'P1',
      identityKey: 'P1-id',
      trailers: { 'P1-id': { description: 'ID', multivalue: false, validation: 'pattern' as const, pattern: '[0-9]+' } }
    });
    const p2 = makeStubProtocolContext({
      name: 'P2',
      namespace: 'ns',
      identityKey: 'P2-id',
      trailers: { 'P2-id': { description: 'ID', multivalue: false, validation: 'none' as const } }
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
    const p1 = makeStubProtocolContext({
     name: 'P1',
     namespace: 'n1',
     trailers: {}
   });
   
   registry.register(p1);
   expect(registry.getByNamespace(GLOBAL_NAMESPACE)).toBeUndefined();
   
   const p2 = makeStubProtocolContext({
     name: 'P2',
     namespace: '',
     trailers: {}
   });
   
   registry.register(p2);
   expect(registry.getByNamespace(GLOBAL_NAMESPACE)).toBe(p2);
 });
});