import { ProtocolQueryAdapter } from '../../../../src/engine/shell/git/protocol-query-adapter.js';
import { TEST_PROTOCOL_DEFINITION, MOCK_CORE_TRAILERS, makeProtocol } from '../../../../src/engine/testing.js';

import { describe, it, expect, beforeEach } from 'vitest';
;
;

describe('ProtocolQueryAdapter', () => {
  let adapter: ProtocolQueryAdapter;

  beforeEach(() => {
    const protocol = makeProtocol({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
    });
    adapter = new ProtocolQueryAdapter(protocol);
  });

  it('should generate discovery pattern for root protocol', () => {
    // TEST_PROTOCOL_DEFINITION uses '^[0-9a-f]{8}$' for pattern, but adapter removes ^ and $
    expect(adapter.getDiscoveryPatterns()).toEqual(['^Mock-id: [0-9a-f]{8}']);
  });

  it('should generate discovery pattern for namespaced protocol', () => {
    const nsProtocol = makeProtocol({
      ...TEST_PROTOCOL_DEFINITION,
      namespace: 'Project'
    });
    const nsAdapter = new ProtocolQueryAdapter(nsProtocol);
    
    expect(nsAdapter.getDiscoveryPatterns()).toEqual(['^Project:']);
  });

  it('should generate search patterns', () => {
    const filters = [{ protocol: null, key: 'Confidence', op: 'eq' as const, value: 'high' }];
    expect(adapter.getSearchPatterns(filters)).toEqual([['^Confidence: high']]);
  });

  it('should generate namespaced search patterns', () => {
    const nsProtocol = makeProtocol({
      ...TEST_PROTOCOL_DEFINITION,
      namespace: 'Project',
      trailers: { 'Confidence': MOCK_CORE_TRAILERS.Confidence }
    });
    const nsAdapter = new ProtocolQueryAdapter(nsProtocol);
    const filters = [{ protocol: null, key: 'Confidence', op: 'eq' as const, value: 'high' }];
    
    expect(nsAdapter.getSearchPatterns(filters)).toEqual([['^Project: Confidence: high']]);
  });

  it('should check if protocol claims raw trailers', () => {
    expect(adapter.claims('Mock-id: 12345678')).toBe(true);
    expect(adapter.claims('Other: value')).toBe(false);
  });

  it('should handle multi-value filters', () => {
    const filters = [{ protocol: null, key: 'Confidence', op: 'eq' as const, value: ['high', 'medium'] }];
    expect(adapter.getSearchPatterns(filters)).toEqual([
      ['^Confidence: high', '^Confidence: medium']
    ]);
  });

  it('should handle missing keys in matches logic by returning false if owned', () => {
      const state = { trailers: {}, unauthorized: {} } as any;
      const filters = [{ protocol: null, key: 'Confidence', op: 'eq' as const, value: 'high' }];
      expect(adapter.matches(state, filters)).toBe(false);
  });

  it('should ignore filters for keys it does not own', () => {
      const state = { trailers: {}, unauthorized: {} } as any;
      const filters = [{ protocol: null, key: 'Unowned', op: 'eq' as const, value: 'value' }];
      expect(adapter.matches(state, filters)).toBe(true);
  });
});