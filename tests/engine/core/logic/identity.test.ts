import { describe, expect,it } from 'vitest';

import { generateId, getProtocolIdentity } from '../../../../src/engine/core/logic/identity.js';
import { makeProtocol } from '../../../../src/engine/testing.js';
import { ConfigurationError } from '../../../../src/engine/util/errors.js';

describe('Identity Logic (Pure Functions)', () => {
  const rootProtocol = makeProtocol({
    name: 'Root',
    version: '1.0',
    identityKey: 'Lore-id',
    trailers: {
      'Lore-id': { description: 'ID', generator: 'hex8' } as any
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
      const uuidProtocol = makeProtocol({
          name: 'UUID',
          identityKey: 'Id',
          trailers: { 'Id': { description: 'ID', generator: 'uuid' } as any }
      });
      const id = generateId(uuidProtocol);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should throw error if generator is "none"', () => {
      const noneProtocol = makeProtocol({
          name: 'None',
          identityKey: 'Id',
          trailers: { 'Id': { description: 'ID', generator: 'none' } as any }
      });
      expect(() => generateId(noneProtocol)).toThrow(ConfigurationError);
    });

    it('should default to hex8 if generator is undefined', () => {
        const ctx = makeProtocol({
            name: 'Default',
            identityKey: 'id',
            trailers: { 'id': { description: 'ID' } as any }
        });
        const id = generateId(ctx);
        expect(id).toHaveLength(8);
        expect(id).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should allow overriding via mock hook', () => {
        const mockProtocol = makeProtocol(rootProtocol['definition']);
        (mockProtocol.def as any).generateId = () => 'FIXED-ID';
        expect(generateId(mockProtocol)).toBe('FIXED-ID');
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
