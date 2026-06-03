import { describe, it, expect, vi } from 'vitest';
import { generateId } from '../../../src/engine/logic/identity.js';
import type { IProtocol } from '../../../src/engine/interfaces/protocol.js';

describe('Identity Logic (Pure Functions)', () => {
  const HEX8_PATTERN = /^[0-9a-f]{8}$/;

  const createMockProtocol = (generatorStrategy: string = 'hex8') => ({
    name: 'TestProtocol',
    identityKey: 'Test-id',
    getDefinition: vi.fn().mockReturnValue({ generator: generatorStrategy }),
  } as any as IProtocol);

  describe('generateId', () => {
    it('should return an 8-character string for hex8', () => {
      const protocol = createMockProtocol('hex8');
      const id = generateId(protocol);
      expect(id).toHaveLength(8);
    });

    it('should return only lowercase hex characters for hex8', () => {
      const protocol = createMockProtocol('hex8');
      const id = generateId(protocol);
      expect(id).toMatch(HEX8_PATTERN);
    });

    it('should generate unique IDs across multiple calls', () => {
      const protocol = createMockProtocol('hex8');
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId(protocol));
      }
      expect(ids.size).toBe(100);
    });

    it('should match the HEX8_PATTERN constant for hex8', () => {
      const protocol = createMockProtocol('hex8');
      for (let i = 0; i < 50; i++) {
        const id = generateId(protocol);
        expect(HEX8_PATTERN.test(id)).toBe(true);
      }
    });

    it('should not contain uppercase characters for hex8', () => {
      const protocol = createMockProtocol('hex8');
      for (let i = 0; i < 50; i++) {
        const id = generateId(protocol);
        expect(id).toBe(id.toLowerCase());
      }
    });

    it('should produce different IDs on consecutive calls', () => {
      const protocol = createMockProtocol('hex8');
      const id1 = generateId(protocol);
      const id2 = generateId(protocol);
      expect(id1).not.toBe(id2);
    });

    it('should be a string type', () => {
      const protocol = createMockProtocol('hex8');
      const id = generateId(protocol);
      expect(typeof id).toBe('string');
    });

    it('should generate a UUID when generator is uuid', () => {
      const protocol = createMockProtocol('uuid');
      const id = generateId(protocol);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should throw an error when generator is none', () => {
      const protocol = createMockProtocol('none');
      expect(() => generateId(protocol)).toThrow(/does not support automatic identity generation/);
    });

    it('should default to hex8 if generator is undefined', () => {
      const protocol = createMockProtocol();
      vi.mocked(protocol.getDefinition).mockReturnValue({} as any);
      const id = generateId(protocol);
      expect(id).toHaveLength(8);
      expect(id).toMatch(HEX8_PATTERN);
    });
  });
});
