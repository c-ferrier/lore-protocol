import { ProtocolMap } from '../../../src/engine/core/models/protocol-map.js';

import { describe, it, expect } from 'vitest';
;

describe('ProtocolMap (Case-Insensitive Logical Identity)', () => {
  it('should normalize keys to lowercase on set', () => {
    const map = new ProtocolMap<string>();
    map.set('Mock', 'value');
    
    // Internal state should be lowercase
    expect(Array.from(map.keys())).toEqual(['mock']);
  });

  it('should retrieve values case-insensitively', () => {
    const map = new ProtocolMap<string>();
    map.set('project', 'active');

    expect(map.get('Project')).toBe('active');
    expect(map.get('PROJECT')).toBe('active');
    expect(map.get('project')).toBe('active');
  });

  it('should check for key existence case-insensitively', () => {
    const map = new ProtocolMap<number>();
    map.set('LORE', 1);

    expect(map.has('lore')).toBe(true);
    expect(map.has('Lore')).toBe(true);
    expect(map.has('LORE')).toBe(true);
    expect(map.has('unknown')).toBe(false);
  });

  it('should delete keys case-insensitively', () => {
    const map = new ProtocolMap<string>();
    map.set('Custom', 'val');
    
    expect(map.delete('CUSTOM')).toBe(true);
    expect(map.has('custom')).toBe(false);
    expect(map.size).toBe(0);
  });

  it('should overwrite existing values regardless of key casing', () => {
    const map = new ProtocolMap<string>();
    map.set('mock', 'v1');
    map.set('Mock', 'v2');
    map.set('MOCK', 'v3');

    expect(map.size).toBe(1);
    expect(map.get('mock')).toBe('v3');
  });
});