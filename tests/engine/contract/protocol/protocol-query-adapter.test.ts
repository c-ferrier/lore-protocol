import { 
    getDiscoveryPatterns, 
    getSearchPatterns, 
    claimsTrailers, 
    matchesFilters 
} from '../../../../src/engine/shell/git/protocol-query-adapter.js';
import { TEST_PROTOCOL_DEFINITION, MOCK_CORE_TRAILERS, makeMockContext } from '../../../../src/engine/testing.js';

import { describe, it, expect, beforeEach } from 'vitest';

describe('ProtocolQueryAdapter Functional', () => {
  let ctx: any;

  beforeEach(() => {
    ctx = makeMockContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
    });
  });

  it('should generate discovery pattern for root protocol', () => {
    expect(getDiscoveryPatterns(ctx)).toEqual(['^Mock-id: [0-9a-f]{8}']);
  });

  it('should generate discovery pattern for namespaced protocol', () => {
    const nsCtx = makeMockContext({
      ...TEST_PROTOCOL_DEFINITION,
      namespace: 'Project'
    });
    
    expect(getDiscoveryPatterns(nsCtx)).toEqual(['^Project:']);
  });

  it('should generate search patterns', () => {
    const filters = [{ protocol: null, key: 'Confidence', op: 'eq' as const, value: 'high' }];
    expect(getSearchPatterns(filters, ctx)).toEqual([['^Confidence: high']]);
  });

  it('should generate namespaced search patterns', () => {
    const nsCtx = makeMockContext({
      ...TEST_PROTOCOL_DEFINITION,
      namespace: 'Project',
      trailers: { 'Confidence': MOCK_CORE_TRAILERS.Confidence }
    });
    const filters = [{ protocol: null, key: 'Confidence', op: 'eq' as const, value: 'high' }];
    
    expect(getSearchPatterns(filters, nsCtx)).toEqual([['^Project: Confidence: high']]);
  });

  it('should check if protocol claims raw trailers', () => {
    expect(claimsTrailers('Mock-id: 12345678', ctx)).toBe(true);
    expect(claimsTrailers('Other: value', ctx)).toBe(false);
  });

  it('should handle multi-value filters', () => {
    const filters = [{ protocol: null, key: 'Confidence', op: 'eq' as const, value: ['high', 'medium'] }];
    expect(getSearchPatterns(filters, ctx)).toEqual([
      ['^Confidence: high', '^Confidence: medium']
    ]);
  });

  it('should handle missing keys in matches logic by returning false if owned', () => {
      const state = { trailers: {}, unauthorized: {} } as any;
      const filters = [{ protocol: null, key: 'Confidence', op: 'eq' as const, value: 'high' }];
      expect(matchesFilters(state, filters, ctx)).toBe(false);
  });

  it('should ignore filters for keys it does not own', () => {
      const state = { trailers: {}, unauthorized: {} } as any;
      const filters = [{ protocol: null, key: 'Unowned', op: 'eq' as const, value: 'value' }];
      expect(matchesFilters(state, filters, ctx)).toBe(true);
  });
});
