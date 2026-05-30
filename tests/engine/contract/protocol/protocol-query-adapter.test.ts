import { describe, it, expect, vi } from 'vitest';
import { ProtocolQueryAdapter } from '../../../../src/engine/services/protocol/protocol-query-adapter.js';
import type { IProtocol } from '../../../../src/engine/interfaces/protocol.js';

describe('ProtocolQueryAdapter', () => {
  const createMockProtocol = (overrides: Partial<IProtocol> = {}) => ({
    name: 'Mock',
    namespace: '',
    identityKey: 'Mock-id',
    permissive: true,
    authorize: vi.fn((key: string) => (key === 'Mock-id' || key === 'Confidence' ? key : null)),
    getDefinition: vi.fn((key: string) => {
        if (key === 'Mock-id') return { key: 'Mock-id', description: '', multivalue: false, pattern: '^[0-9a-f]{8}$' };
        return null;
    }),
    owns: vi.fn((key: string) => key === 'Mock-id'),
    ...overrides
  } as unknown as IProtocol);

  it('should generate discovery pattern for root protocol', () => {
    const protocol = createMockProtocol();
    const adapter = new ProtocolQueryAdapter(protocol);
    
    // ^Mock-id: [0-9a-f]{8}
    expect(adapter.getDiscoveryPattern()).toBe('^Mock-id: [0-9a-f]{8}');
  });

  it('should generate discovery pattern for namespaced protocol', () => {
    const protocol = createMockProtocol({ namespace: 'Project' });
    const adapter = new ProtocolQueryAdapter(protocol);
    
    expect(adapter.getDiscoveryPattern()).toBe('^Project:');
  });

  it('should generate search grep arguments', () => {
    const protocol = createMockProtocol();
    const adapter = new ProtocolQueryAdapter(protocol);
    
    const filters = { Confidence: 'high' };
    expect(adapter.getSearchGrep(filters)).toEqual(['--grep=^Confidence: high']);
  });

  it('should generate namespaced search grep arguments', () => {
    const protocol = createMockProtocol({ namespace: 'Project' });
    const adapter = new ProtocolQueryAdapter(protocol);
    
    const filters = { Confidence: 'high' };
    expect(adapter.getSearchGrep(filters)).toEqual(['--grep=^Project: Confidence: high']);
  });

  it('should check if protocol claims raw trailers', () => {
    const protocol = createMockProtocol({ identityKey: 'Lore-id' });
    const adapter = new ProtocolQueryAdapter(protocol);
    
    expect(adapter.claims('Lore-id: abc12345')).toBe(true);
    expect(adapter.claims('Other-id: xyz')).toBe(false);
  });

  it('should generate multiple grep arguments for multi-value filters', () => {
    const protocol = createMockProtocol();
    const adapter = new ProtocolQueryAdapter(protocol);
    
    const filters = { Confidence: ['high', 'low'] };
    expect(adapter.getSearchGrep(filters)).toEqual([
        '--grep=^Confidence: high',
        '--grep=^Confidence: low'
    ]);
  });

  it('should handle missing keys in matches logic by returning false if owned', () => {
    const protocol = createMockProtocol();
    const adapter = new ProtocolQueryAdapter(protocol);
    
    const state = {
        trailers: {}, // Missing Confidence
        unauthorized: {}
    };

    expect(adapter.matches(state, { Confidence: 'high' })).toBe(false);
  });

  it('should ignore filters for keys it does not own', () => {
    const protocol = createMockProtocol();
    const adapter = new ProtocolQueryAdapter(protocol);
    
    const state = {
        trailers: { Confidence: ['high'] },
        unauthorized: {}
    };

    expect(adapter.matches(state, { Unknown: 'val' })).toBe(true);
  });
});
