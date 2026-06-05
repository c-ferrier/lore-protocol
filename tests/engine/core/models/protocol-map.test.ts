import { ProtocolMap } from '../../../../src/engine/core/models/protocol-map.js';
import { describe, it, expect } from 'vitest';

describe('ProtocolMap (Logic)', () => {
  it('should normalize keys to lowercase', () => {
    const map = new ProtocolMap<string>();
    map.set('Mock', 'value');
    expect(Array.from(map.keys())).toEqual(['mock']);
  });
});
