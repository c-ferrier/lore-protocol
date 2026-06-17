import { describe, expect,it } from 'vitest';

import { ProtocolMap } from '../../../src/core/models/protocol-map.js';

describe('ProtocolMap (Logic)', () => {
  it('should normalize keys to lowercase', () => {
    const map = new ProtocolMap<string>();
    map.set('Mock', 'value');
    expect(Array.from(map.keys())).toEqual(['mock']);
  });
});
