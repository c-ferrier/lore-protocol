import { describe, it, expect, beforeEach } from 'vitest';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { TEST_ENGINE_CONFIG, makeProtocolConfig } from '../engine-test-utils.js';

describe('ProtocolRegistry Advanced', () => {
  let registry: ProtocolRegistry;

  beforeEach(() => {
    registry = new ProtocolRegistry();
  });

  it('should generate correct aggregated discovery grep for multiple protocols', () => {
    const p1 = new Protocol({ 
      name: 'P1', 
      version: '1', 
      identityKey: 'P1-id', 
      namespace: '', 
      trailers: { 'P1-id': { description: '', multivalue: false, validation: 'pattern', pattern: '[0-9]+' } } 
    }, makeProtocolConfig(TEST_ENGINE_CONFIG));
    const p2 = new Protocol({ 
      name: 'P2', 
      version: '1', 
      identityKey: 'P2-id', 
      namespace: 'ns', 
      trailers: { 'P2-id': { description: '', multivalue: false, validation: 'pattern', pattern: '[a-z]+' } } 
    }, makeProtocolConfig(TEST_ENGINE_CONFIG));

    registry.register(p1);
    registry.register(p2);

    const grep = registry.getDiscoveryGrep();
    expect(grep).toHaveLength(1);
    expect(grep[0]).toContain('(^P1-id: [0-9]+)|(^ns:)');
  });

  it('should return empty array if no protocols are registered', () => {
    expect(registry.getDiscoveryGrep()).toEqual([]);
  });

  it('should find protocols by namespace', () => {
     const p1 = new Protocol({
      name: 'P1',
      version: '1.0',
      identityKey: 'P1-id',
      namespace: 'n1',
      trailers: {}
    }, makeProtocolConfig(TEST_ENGINE_CONFIG));
    
    registry.register(p1);
    expect(registry.getRoot()).toBeUndefined();
    
    const p2 = new Protocol({
      name: 'P2',
      version: '1.0',
      identityKey: 'P2-id',
      namespace: '',
      trailers: {}
    }, makeProtocolConfig(TEST_ENGINE_CONFIG));
    
    registry.register(p2);
    expect(registry.getRoot()).toBe(p2);
  });
});
