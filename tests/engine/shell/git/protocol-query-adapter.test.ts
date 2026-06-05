import { describe, it, expect } from 'vitest';
import { getDiscoveryPatterns, getSearchPatterns } from '../../../../src/engine/shell/git/protocol-query-adapter.js';
import { makeMockContext } from '../../../../src/engine/testing.js';

describe('ProtocolQueryAdapter (Implementation)', () => {
  const ctx = makeMockContext({ name: 'Mock', identityKey: 'Mock-id' });

  it('should delegate discovery patterns to logic', () => {
    const patterns = getDiscoveryPatterns(ctx);
    expect(patterns).toContain('^Mock-id: [0-9a-f]{8}');
  });

  it('should delegate search patterns to logic', () => {
      const filters = [{ protocol: null, key: 'Mock-id', op: 'eq' as const, value: 'a1b2c3d4' }];
      const patterns = getSearchPatterns(filters, ctx);
      expect(patterns).toEqual([['^Mock-id: a1b2c3d4']]);
  });
});
