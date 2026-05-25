import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import { LORE_DEFAULT_CONFIG } from '../../../../src/lore/defaults.js';

describe('Namespace Logic Edge Cases', () => {
  let registry: ProtocolRegistry;
  
  const STRICT_DEF = {
    name: 'Strict',
    version: '1.0',
    identityKey: 'Id',
    namespace: 'st',
    trailers: { 'Id': { description: 'ID', validation: 'none' as const } }
  };

  const PERMISSIVE_DEF = {
    name: 'Permissive',
    version: '1.0',
    identityKey: 'Id',
    namespace: 'pm',
    trailers: { 'Id': { description: 'ID', validation: 'none' as const } }
  };

  beforeEach(() => {
    registry = new ProtocolRegistry();
  });

  it('should ignore trailers with unknown namespaces', () => {
    const protocol = new Protocol(STRICT_DEF, LORE_DEFAULT_CONFIG);
    const trailers = 'Id: 123\nunknown/Key: val';
    const state = protocol.parse(trailers);
    
    expect(state.trailers['unknown/Key']).toBeUndefined();
    expect(state.trailers['Key']).toBeUndefined();
  });

  it('should allow two strict protocols to define the same key in different namespaces', () => {
    const p1 = new Protocol({...STRICT_DEF, name: 'P1', namespace: 'p1'}, LORE_DEFAULT_CONFIG);
    const p2 = new Protocol({...STRICT_DEF, name: 'P2', namespace: 'p2'}, LORE_DEFAULT_CONFIG);
    
    const trailers = 'p1/Id: 1\np2/Id: 2';
    
    const s1 = p1.parse(trailers);
    const s2 = p2.parse(trailers);
    
    expect(s1.trailers['Id']).toEqual(['1']);
    expect(s2.trailers['Id']).toEqual(['2']);
  });

  it('should not allow a permissive protocol to eat namespaced trailers of another protocol', () => {
    const permissive = new Protocol({...PERMISSIVE_DEF, namespace: ''}, LORE_DEFAULT_CONFIG);
    const strict = new Protocol(STRICT_DEF, {
      ...LORE_DEFAULT_CONFIG,
      trailers: { ...LORE_DEFAULT_CONFIG.trailers, permissive: false }
    });
    
    const trailers = 'Id: lore123\nst/Id: strict123';
    
    // Explicitly claim st/Id
    const claimed = new Set(['st/Id']);
    const state = permissive.parse(trailers, claimed);
    
    expect(state.trailers['Id']).toEqual(['lore123']);
    expect(state.trailers['st/Id']).toBeUndefined();
  });
});
