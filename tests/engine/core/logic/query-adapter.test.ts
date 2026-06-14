import { describe, expect,it } from 'vitest';

import { 
    claimsTrailers,
    getDiscoveryPatterns, 
    getIdentityPattern, 
    getSearchPatterns, 
    matchesFilters} from '../../../../src/engine/core/logic/query-adapter.js';
import { makeStubProtocolContext, makeStubProtocolState } from '../../../../src/engine/testing.js';

describe('Query Adapter Logic (Pure Functions)', () => {
  const rootCtx = makeStubProtocolContext({
    name: 'Root',
    namespace: '',
    identityKey: 'Lore-id',
    trailers: { 'Lore-id': { description: 'ID', multivalue: false, validation: 'pattern' as const, pattern: '^[0-9a-f]{8}$' } }
  });

  const nsCtx = makeStubProtocolContext({
    name: 'Project',
    namespace: 'Project',
    identityKey: 'Id',
    trailers: { 'Id': { description: 'ID', multivalue: false, validation: 'none' as const } }
  });

  describe('getDiscoveryPatterns', () => {
    it('should return identity pattern for root protocol', () => {
      expect(getDiscoveryPatterns(rootCtx)).toEqual(['^Lore-id: [0-9a-f]{8}']);
    });

    it('should return namespace pattern for namespaced protocol', () => {
      expect(getDiscoveryPatterns(nsCtx)).toEqual(['^Project:']);
    });
  });

  describe('getIdentityPattern', () => {
    it('should return flat pattern for root', () => {
      expect(getIdentityPattern('a1b2c3d4', rootCtx)).toBe('^Lore-id: a1b2c3d4$');
    });

    it('should return prefixed pattern for namespaced', () => {
      expect(getIdentityPattern('12345', nsCtx)).toBe('^Project: Id: 12345$');
    });
  });

  describe('getSearchPatterns', () => {
    it('should translate "has" filter to prefix regex', () => {
      const filters = [{ protocol: 'root', key: 'Lore-id', op: 'has' as const, value: 'true' }];
      expect(getSearchPatterns(filters, rootCtx)).toEqual([['^Lore-id:']]);
    });

    it('should translate "eq" filter to exact match regex', () => {
      const filters = [{ protocol: 'root', key: 'Lore-id', op: 'eq' as const, value: 'a1b2c3d4' }];
      expect(getSearchPatterns(filters, rootCtx)).toEqual([['^Lore-id: a1b2c3d4']]);
    });

    it('should handle namespaced prefix', () => {
      const filters = [{ protocol: 'project', key: 'Id', op: 'eq' as const, value: '12345' }];
      expect(getSearchPatterns(filters, nsCtx)).toEqual([['^Project: Id: 12345']]);
    });
  });

  describe('matchesFilters', () => {
    it('should match simple equality', () => {
      const state = makeStubProtocolState({ trailers: { 'Lore-id': ['a1b2c3d4'] } });
      const filters = [{ protocol: 'root', key: 'Lore-id', op: 'eq' as const, value: 'a1b2c3d4' }];
      expect(matchesFilters(state, filters, rootCtx)).toBe(true);
    });

    it('should match "has" operator', () => {
      const state = makeStubProtocolState({ trailers: { 'Lore-id': ['a1b2c3d4'] } });
      const filters = [{ protocol: 'root', key: 'Lore-id', op: 'has' as const, value: 'true' }];
      expect(matchesFilters(state, filters, rootCtx)).toBe(true);
    });

    it('should return false on mismatch', () => {
      const state = makeStubProtocolState({ trailers: { 'Lore-id': ['a1b2c3d4'] } });
      const filters = [{ protocol: 'root', key: 'Lore-id', op: 'eq' as const, value: 'other' }];
      expect(matchesFilters(state, filters, rootCtx)).toBe(false);
    });
  });

  describe('claimsTrailers', () => {
    it('should claim if identity key is present for root', () => {
      expect(claimsTrailers('Lore-id: a1b2c3d4', rootCtx)).toBe(true);
      expect(claimsTrailers('Other: value', rootCtx)).toBe(false);
    });

    it('should claim if namespace is present for namespaced', () => {
      expect(claimsTrailers('Project: Id: 123', nsCtx)).toBe(true);
      expect(claimsTrailers('Id: 123', nsCtx)).toBe(false);
    });
  });
});
