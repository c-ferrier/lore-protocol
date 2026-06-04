import { generateId } from '../../../src/engine/core/logic/identity.js';
import { createProtocolContext } from '../../../src/engine/core/logic/protocols.js';

import { describe, it, expect } from 'vitest';

describe('Identity Logic (Pure Functions)', () => {
  const HEX8_PATTERN = /^[0-9a-f]{8}$/;

  const createTestContext = (generatorStrategy: string = 'hex8') => {
    return createProtocolContext({
      name: 'TestProtocol',
      version: '1.0',
      namespace: '',
      strict: true,
      permissive: false,
      identityKey: 'Test-id',
      trailers: {
        'Test-id': { description: 'ID', multivalue: false, validation: 'pattern', generator: generatorStrategy as any }
      }
    });
  };

  describe('generateId', () => {
    it('should return an 8-character string for hex8', () => {
      const ctx = createTestContext('hex8');
      const id = generateId(ctx);
      expect(id).toHaveLength(8);
    });

    it('should return only lowercase hex characters for hex8', () => {
      const ctx = createTestContext('hex8');
      const id = generateId(ctx);
      expect(id).toMatch(HEX8_PATTERN);
    });

    it('should generate unique IDs across multiple calls', () => {
      const ctx = createTestContext('hex8');
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId(ctx));
      }
      expect(ids.size).toBe(100);
    });

    it('should match the HEX8_PATTERN constant for hex8', () => {
      const ctx = createTestContext('hex8');
      for (let i = 0; i < 50; i++) {
        const id = generateId(ctx);
        expect(HEX8_PATTERN.test(id)).toBe(true);
      }
    });

    it('should not contain uppercase characters for hex8', () => {
      const ctx = createTestContext('hex8');
      for (let i = 0; i < 50; i++) {
        const id = generateId(ctx);
        expect(id).toBe(id.toLowerCase());
      }
    });

    it('should produce different IDs on consecutive calls', () => {
      const ctx = createTestContext('hex8');
      const id1 = generateId(ctx);
      const id2 = generateId(ctx);
      expect(id1).not.toBe(id2);
    });

    it('should be a string type', () => {
      const ctx = createTestContext('hex8');
      const id = generateId(ctx);
      expect(typeof id).toBe('string');
    });

    it('should generate a UUID when generator is uuid', () => {
      const ctx = createTestContext('uuid');
      const id = generateId(ctx);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should throw an error when generator is none', () => {
      const ctx = createTestContext('none');
      expect(() => generateId(ctx)).toThrow(/does not support automatic identity generation/);
    });

    it('should default to hex8 if generator is undefined', () => {
      const ctx = createProtocolContext({
        name: 'TestProtocol',
        version: '1.0',
        namespace: '',
        strict: true,
        permissive: false,
        identityKey: 'Test-id',
        trailers: {
          'Test-id': { description: 'ID', multivalue: false, validation: 'none' } as any
        }
      });
      const id = generateId(ctx);
      expect(id).toHaveLength(8);
      expect(id).toMatch(HEX8_PATTERN);
    });
  });
});
