import { makeMockContext } from '../../../../src/engine/testing.js';
import { type ProtocolDefinition } from '../../../../src/engine/core/types/protocol-definition.js';
import { getStaleSignals } from '../../../../src/engine/core/logic/staleness.js';
import { ProtocolMap } from '../../../../src/engine/core/types/domain.js';

import { describe, it, expect } from 'vitest';

describe('ProtocolInterpreter - Declarative Rules (Edge Cases)', () => {
  
  const createMockProtocol = (definitionOverrides: Partial<ProtocolDefinition> = {}) => {
    return makeMockContext({
        name: 'Mock',
        version: '1.0',
        namespace: '',
        identityKey: 'Mock-id',
        strict: false,
        permissive: true,
        trailers: {},
        ...definitionOverrides
    });
  };

  it('should handle multiple triggers on a single trailer', () => {
    const protocol = createMockProtocol({
      trailers: {
        'Status': {
            description: '', multivalue: true, validation: 'none',
            stale_if: [
                { kind: 'value-equals', value: 'deprecated', signal: 'is-deprecated' },
                { kind: 'date-expired', signal: 'past-deadline' }
            ]
        } as any
      }
    });

    const now = new Date(2025, 0, 1);
    const atom: any = {
      protocols: new ProtocolMap([['mock', { 
          trailers: { Status: ['deprecated [until:2024-01-01]'] }, 
          unauthorized: {} 
      }]])
    };

    const signals = getStaleSignals(protocol, atom, now, new Map());
    expect(signals).toHaveLength(2);
    expect(signals.map(s => s.signal)).toContain('is-deprecated');
    expect(signals.map(s => s.signal)).toContain('past-deadline');
  });

  it('should handle multi-value trailers by evaluating triggers against each value', () => {
    const protocol = createMockProtocol({
      trailers: {
        'Tags': {
            description: '', multivalue: true, validation: 'none',
            stale_if: { kind: 'value-equals', value: 'stale-tag' }
        } as any
      }
    });

    const atom: any = {
      protocols: new ProtocolMap([['mock', { 
          trailers: { Tags: ['fresh', 'stale-tag', 'stale-tag'] }, 
          unauthorized: {} 
      }]])
    };

    const signals = getStaleSignals(protocol, atom, new Date(), new Map());
    expect(signals).toHaveLength(2);
  });

  it('should support cross-protocol "reference-superseded" checks with qualified IDs', () => {
    const protocol = createMockProtocol({
      name: 'Lore',
      identityKey: 'Lore-id',
      trailers: {
        'Depends-on': {
            description: '', multivalue: true, validation: 'reference',
            stale_if: { kind: 'reference-superseded' }
        } as any
      }
    });

    // Global map showing a security atom being superseded
    const globalMap = new Map([
        ['sec', new Map([['cve-1234', { superseded: true, supersededBy: ['sec/cve-5678'] }]])]
    ]);

    const atom: any = {
      protocols: new ProtocolMap([['lore', { 
          trailers: { 'Lore-id': ['a1b2c3d4'], 'Depends-on': ['sec/cve-1234'] }, 
          unauthorized: {} 
      }]])
    };

    const signals = getStaleSignals(protocol, atom, new Date(), globalMap);
    expect(signals).toHaveLength(1);
    expect(signals[0].description).toContain('Dependency "sec/cve-1234"');
    expect(signals[0].description).toContain('superseded by sec/cve-5678');
  });

  it('should correctly handle "reference-superseded" when supersededBy is a qualified ID', () => {
    const protocol = createMockProtocol({
      name: 'Mock',
      identityKey: 'Mock-id',
      trailers: {
        'Supersedes': {
            description: '', multivalue: true, validation: 'reference',
            stale_if: { kind: 'reference-superseded' }
        } as any
      }
    });

    const globalMap = new Map([
        ['mock', new Map([['deadbeef', { superseded: true, supersededBy: 'mock/a1b2c3d4' }]])]
    ]);

    const atom: any = {
      protocols: new ProtocolMap([['mock', { 
          trailers: { 'Mock-id': ['a1b2c3d4'], 'Supersedes': ['deadbeef'] }, 
          unauthorized: {} 
      }]])
    };

    const signals = getStaleSignals(protocol, atom, new Date(), globalMap);
    expect(signals).toHaveLength(0);
  });

  it('should ignore stale_if triggers on unauthorized trailers', () => {
    const protocol = createMockProtocol({
      trailers: {
        'Authorized': {
            description: '', multivalue: false,
            stale_if: { kind: 'value-equals', value: 'stale' }
        } as any
      }
    });

    const atom: any = {
      protocols: new ProtocolMap([['mock', { 
          trailers: { Authorized: ['fresh'] }, 
          unauthorized: { Unauthorized: ['stale'] } 
      }]])
    };

    const signals = getStaleSignals(protocol, atom, new Date(), new Map());
    expect(signals).toHaveLength(0);
  });
});
