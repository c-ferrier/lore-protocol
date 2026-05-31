import { describe, it, expect } from 'vitest';
import { FilterResolver } from '../../../src/engine/services/filter-resolver.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';

describe('FilterResolver', () => {
  const registry = new ProtocolRegistry();

  describe('resolve()', () => {
    it('should parse an unqualified key with default operator (eq)', () => {
      const raw = { Status: 'active' };
      const filters = FilterResolver.resolve(raw, registry);

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        protocol: null,
        key: 'Status',
        op: 'eq',
        value: 'active'
      });
    });

    it('should parse a qualified key with default operator (eq)', () => {
      const raw = { 'project/Status': 'active' };
      const filters = FilterResolver.resolve(raw, registry);

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        protocol: 'project',
        key: 'Status',
        op: 'eq',
        value: 'active'
      });
    });

    /*
    it('should parse an unqualified key with a specific operator', () => {
      const raw = { 'Status:ne': 'archived' };
      const filters = FilterResolver.resolve(raw, registry);

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        protocol: null,
        key: 'Status',
        op: 'ne',
        value: 'archived'
      });
    });

    it('should parse a qualified key with a specific operator', () => {
      const raw = { 'project/Version:gt': '1.0.0' };
      const filters = FilterResolver.resolve(raw, registry);

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        protocol: 'project',
        key: 'Version',
        op: 'gt',
        value: '1.0.0'
      });
    });
    */

    it('should fall back to "eq" if the operator is invalid/unsupported', () => {
      // Assuming 'foo' is not in the supported operator list
      const raw = { 'Status:foo': 'active' };
      const filters = FilterResolver.resolve(raw, registry);

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        protocol: null,
        key: 'Status',
        op: 'eq',
        value: 'active'
      });
    });

    it('should ignore undefined or null values', () => {
      const raw = { 
        Valid: 'yes', 
        InvalidNull: null, 
        InvalidUndefined: undefined 
      };
      const filters = FilterResolver.resolve(raw, registry);

      expect(filters).toHaveLength(1);
      expect(filters[0].key).toBe('Valid');
    });

    /*
    it('should handle arrays of values correctly', () => {
      const raw = { 'Status:in': ['active', 'pending'] };
      const filters = FilterResolver.resolve(raw);

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        protocol: null,
        key: 'Status',
        op: 'in',
        value: ['active', 'pending']
      });
    });
    */
  });
});
