import { describe, it, expect, vi } from 'vitest';
import { ProtocolInterpreter } from '../../../../../src/engine/services/protocol/protocol-interpreter.js';
import { TrailerParser } from '../../../../../src/engine/services/trailer-parser.js';
import type { IProtocol } from '../../../../../src/engine/interfaces/protocol.js';

describe('ProtocolInterpreter - Declarative Rules (Edge Cases)', () => {
  const parser = new TrailerParser();
  
  const createMockProtocol = (overrides: Partial<IProtocol> = {}) => ({
    name: 'Mock',
    namespace: '',
    identityKey: 'Mock-id',
    permissive: true,
    getAuthorizedKeys: vi.fn(() => []),
    getDefinition: vi.fn(),
    authorize: vi.fn(key => key),
    owns: vi.fn(() => true),
    ...overrides
  } as unknown as IProtocol);

  it('should handle multiple triggers on a single trailer', () => {
    const protocol = createMockProtocol({
      getAuthorizedKeys: () => ['Status'],
      getDefinition: (key: string) => ({
          key, description: '', multivalue: true,
          stale_if: [
              { kind: 'value-equals', value: 'deprecated', signal: 'is-deprecated' },
              { kind: 'date-expired', signal: 'past-deadline' }
          ]
      } as any)
    });
    const interpreter = new ProtocolInterpreter(protocol, parser);

    const now = new Date(2025, 0, 1);
    const atom: any = {
      protocols: new Map([['mock', { 
          trailers: { Status: ['deprecated [until:2024-01-01]'] }, 
          unauthorized: {} 
      }]])
    };

    const signals = interpreter.getStaleSignals(atom, now, new Map());
    // Should trigger BOTH: value-equals ('deprecated') and date-expired ('2024-01-01')
    expect(signals).toHaveLength(2);
    expect(signals.map(s => s.signal)).toContain('is-deprecated');
    expect(signals.map(s => s.signal)).toContain('past-deadline');
  });

  it('should handle multi-value trailers by evaluating triggers against each value', () => {
    const protocol = createMockProtocol({
      getAuthorizedKeys: () => ['Tags'],
      getDefinition: (key: string) => ({
          key, description: '', multivalue: true,
          stale_if: { kind: 'value-equals', value: 'stale-tag' }
      } as any)
    });
    const interpreter = new ProtocolInterpreter(protocol, parser);

    const atom: any = {
      protocols: new Map([['mock', { 
          trailers: { Tags: ['fresh', 'stale-tag', 'stale-tag'] }, 
          unauthorized: {} 
      }]])
    };

    const signals = interpreter.getStaleSignals(atom, new Date(), new Map());
    // Should trigger twice for 'stale-tag'
    expect(signals).toHaveLength(2);
  });

  it('should support cross-protocol "reference-superseded" checks with qualified IDs', () => {
    const protocol = createMockProtocol({
      name: 'Lore',
      identityKey: 'Lore-id',
      getAuthorizedKeys: () => ['Depends-on'],
      getDefinition: (key: string) => ({
          key, description: '', multivalue: true,
          stale_if: { kind: 'reference-superseded' }
      } as any)
    });
    const interpreter = new ProtocolInterpreter(protocol, parser);

    // Global map showing a security atom being superseded
    const globalMap = new Map([
        ['sec', new Map([['cve-123', { superseded: true, supersededBy: 'sec/cve-456' }]])]
    ]);

    const atom: any = {
      protocols: new Map([['lore', { 
          trailers: { 'Lore-id': ['a1'], 'Depends-on': ['sec/cve-123'] }, 
          unauthorized: {} 
      }]])
    };

    const signals = interpreter.getStaleSignals(atom, new Date(), globalMap);
    expect(signals).toHaveLength(1);
    expect(signals[0].description).toContain('Dependency "sec/cve-123"');
    expect(signals[0].description).toContain('superseded by sec/cve-456');
  });

  it('should correctly handle "reference-superseded" when supersededBy is a qualified ID', () => {
    const protocol = createMockProtocol({
      name: 'Mock',
      identityKey: 'Mock-id',
      getAuthorizedKeys: () => ['Supersedes'],
      getDefinition: (key: string) => ({
          key, description: '', multivalue: true,
          stale_if: { kind: 'reference-superseded' }
      } as any)
    });
    const interpreter = new ProtocolInterpreter(protocol, parser);

    const globalMap = new Map([
        ['mock', new Map([['old-id', { superseded: true, supersededBy: 'mock/active-id' }]])]
    ]);

    const atom: any = {
      protocols: new Map([['mock', { 
          trailers: { 'Mock-id': ['active-id'], 'Supersedes': ['old-id'] }, 
          unauthorized: {} 
      }]])
    };

    const signals = interpreter.getStaleSignals(atom, new Date(), globalMap);
    // Should be empty because 'mock/active-id' is us
    expect(signals).toHaveLength(0);
  });

  it('should ignore stale_if triggers on unauthorized trailers', () => {
    const protocol = createMockProtocol({
      getAuthorizedKeys: () => ['Authorized'],
      getDefinition: (key: string) => ({
          key, description: '', multivalue: false,
          stale_if: { kind: 'value-equals', value: 'stale' }
      } as any)
    });
    const interpreter = new ProtocolInterpreter(protocol, parser);

    const atom: any = {
      protocols: new Map([['mock', { 
          trailers: { Authorized: ['fresh'] }, 
          unauthorized: { Unauthorized: ['stale'] } 
      }]])
    };

    const signals = interpreter.getStaleSignals(atom, new Date(), new Map());
    expect(signals).toHaveLength(0);
  });
});
