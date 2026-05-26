import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IdGenerator } from '../../../../src/engine/services/id-generator.js';
import type { IProtocol } from '../../../../src/engine/interfaces/protocol.js';

describe('IdGenerator', () => {
  let mockProtocol: IProtocol;
  let generator: IdGenerator;

  const HEX8_PATTERN = /^[0-9a-f]{8}$/;

  beforeEach(() => {
    mockProtocol = {
      name: 'TestProtocol',
      identityKey: 'Test-id',
      getDefinition: vi.fn().mockReturnValue({ generator: 'hex8' }),
    } as any;
    generator = new IdGenerator();
  });

  describe('generate', () => {
    it('should return an 8-character string for hex8', () => {
      const id = generator.generate(mockProtocol);
      expect(id).toHaveLength(8);
    });

    it('should return only lowercase hex characters for hex8', () => {
      const id = generator.generate(mockProtocol);
      expect(id).toMatch(HEX8_PATTERN);
    });

    it('should generate unique IDs across multiple calls', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generator.generate(mockProtocol));
      }
      expect(ids.size).toBe(100);
    });

    it('should match the HEX8_PATTERN constant for hex8', () => {
      for (let i = 0; i < 50; i++) {
        const id = generator.generate(mockProtocol);
        expect(HEX8_PATTERN.test(id)).toBe(true);
      }
    });

    it('should not contain uppercase characters for hex8', () => {
      for (let i = 0; i < 50; i++) {
        const id = generator.generate(mockProtocol);
        expect(id).toBe(id.toLowerCase());
      }
    });

    it('should produce different IDs on consecutive calls', () => {
      const id1 = generator.generate(mockProtocol);
      const id2 = generator.generate(mockProtocol);
      expect(id1).not.toBe(id2);
    });

    it('should be a string type', () => {
      const id = generator.generate(mockProtocol);
      expect(typeof id).toBe('string');
    });

    it('should generate a UUID when generator is uuid', () => {
      vi.mocked(mockProtocol.getDefinition).mockReturnValue({ generator: 'uuid' } as any);
      const id = generator.generate(mockProtocol);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should throw an error when generator is none', () => {
      vi.mocked(mockProtocol.getDefinition).mockReturnValue({ generator: 'none' } as any);
      expect(() => generator.generate(mockProtocol)).toThrow(/does not support automatic identity generation/);
    });

    it('should default to hex8 if generator is undefined', () => {
      vi.mocked(mockProtocol.getDefinition).mockReturnValue({} as any);
      const id = generator.generate(mockProtocol);
      expect(id).toHaveLength(8);
      expect(id).toMatch(HEX8_PATTERN);
    });
  });
});
