import { describe, expect,it } from 'vitest';

import { generateId, getProtocolIdentity } from '../../../../src/engine/core/logic/identity.js';
import { makeStubProtocolContext } from '../../../../src/engine/testing.js';
import { ConfigurationError } from '../../../../src/engine/util/errors.js';

describe('Identity Logic (Pure Functions)', () => {
  const rootProtocol = makeStubProtocolContext({
    name: 'Root',
    version: '1.0',
    identityKey: 'Lore-id',
    trailers: {
      'Lore-id': { description: 'ID', multivalue: false, validation: 'pattern', pattern: '^[0-9a-f]{8}$', generator: 'hex8' }
    }
  });

  describe('generateId', () => {
    it('should generate an 8-char hex ID by default', () => {
      const id = generateId(rootProtocol);
      expect(id).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should generate unique IDs across multiple calls', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 100; i++) {
          ids.add(generateId(rootProtocol));
        }
        expect(ids.size).toBe(100);
    });

    it('should support UUID generation', () => {
      const uuidProtocol = makeStubProtocolContext({
          name: 'UUID',
          identityKey: 'Id',
          trailers: { 'Id': { description: 'ID', multivalue: false, validation: 'none', generator: 'uuid' } }
      });
      const id = generateId(uuidProtocol);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should throw error if generator is "none"', () => {
      const noneProtocol = makeStubProtocolContext({
          name: 'None',
          identityKey: 'Id',
          trailers: { 'Id': { description: 'ID', multivalue: false, validation: 'none', generator: 'none' } }
      });
      expect(() => generateId(noneProtocol)).toThrow(ConfigurationError);
    });

    it('should default to hex8 if generator is undefined', () => {
        const ctx = makeStubProtocolContext({
            name: 'Default',
            identityKey: 'id',
            trailers: { 'id': { description: 'ID', multivalue: false, validation: 'none' } }
        });
        const id = generateId(ctx);
        expect(id).toHaveLength(8);
        expect(id).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe('getProtocolIdentity', () => {
      it('should extract the first value of the identity key', () => {
          const state = { trailers: { 'Lore-id': ['a1b2c3d4'] }, unauthorized: {} };
          expect(getProtocolIdentity(state, rootProtocol)).toBe('a1b2c3d4');
      });

      it('should return null if state is missing', () => {
          expect(getProtocolIdentity(null, rootProtocol)).toBeNull();
      });

      it('should return null if identity key is missing', () => {
          const state = { trailers: {}, unauthorized: {} };
          expect(getProtocolIdentity(state, rootProtocol)).toBeNull();
      });
  });
});
