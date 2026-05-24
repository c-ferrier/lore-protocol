import { describe, it, expect } from 'vitest';
import { IdGenerator } from '../../../src/services/id-generator.js';
import { ID_PATTERN } from '../../../src/util/constants.js';

describe('IdGenerator', () => {
  const generator = new IdGenerator();

  describe('generate', () => {
    it('should return an 8-character string', () => {
      const id = generator.generate();
      expect(id).toHaveLength(8);
    });

    it('should return only lowercase hex characters', () => {
      const id = generator.generate();
      expect(id).toMatch(ID_PATTERN);
    });

    it('should generate unique IDs across multiple calls', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generator.generate());
      }
      // With 4 bytes of randomness (2^32 possibilities), 100 IDs should all be unique
      expect(ids.size).toBe(100);
    });

    it('should match the ID_PATTERN constant', () => {
      for (let i = 0; i < 50; i++) {
        const id = generator.generate();
        expect(ID_PATTERN.test(id)).toBe(true);
      }
    });

    it('should not contain uppercase characters', () => {
      for (let i = 0; i < 50; i++) {
        const id = generator.generate();
        expect(id).toBe(id.toLowerCase());
      }
    });

    it('should produce different IDs on consecutive calls', () => {
      const id1 = generator.generate();
      const id2 = generator.generate();
      expect(id1).not.toBe(id2);
    });

    it('should be a string type', () => {
      const id = generator.generate();
      expect(typeof id).toBe('string');
    });
  });
});
