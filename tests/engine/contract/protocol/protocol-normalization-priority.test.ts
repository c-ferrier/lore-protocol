import { describe, it, expect, vi } from 'vitest';
import { ProtocolInterpreter } from '../../../../src/engine/services/protocol/protocol-interpreter.js';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import type { IProtocol } from '../../../../src/engine/interfaces/protocol.js';

describe('ProtocolInterpreter Normalization Priority Matrix', () => {
  const parser = new TrailerParser();

  const createMockProtocol = (overrides: Partial<IProtocol> = {}) => ({
    name: 'Mock',
    namespace: '',
    permissive: true,
    identityKey: 'Mock-id',
    owns: vi.fn((key: string) => key === 'Owned'),
    authorize: vi.fn((key: string) => key === 'Owned' ? 'Owned' : null),
    getAuthorizedKeys: vi.fn(() => ['Owned']),
    getDefinition: vi.fn(),
    isValidIdentity: vi.fn(() => true),
    ...overrides
  } as unknown as IProtocol);

  it('Step 1: Explicit Ownership should always win', () => {
    const protocol = createMockProtocol({ permissive: true });
    const interpreter = new ProtocolInterpreter(protocol, parser);
    
    // Even if it looks like a namespace (Step 2) or is reserved (Step 3),
    // if we explicitly own it in our schema, we take it.
    const raw = {
      'Owned': ['value']
    };

    const state = interpreter.normalize(raw, new Set(['Owned'])); // Reserved by others
    expect(state.trailers.Owned).toEqual(['value']);
    expect(state.unauthorized).toEqual({});
  });

  it('Step 2: Namespace Exclusion (Root Protocol ignores qualified trailers)', () => {
    const protocol = createMockProtocol({ namespace: '', permissive: true });
    const interpreter = new ProtocolInterpreter(protocol, parser);
    
    const raw = {
      'Other': ['Key: value'] // Qualified trailer
    };

    const state = interpreter.normalize(raw);
    // Root protocol ignores things with colons in values that it doesn't own
    expect(state.trailers.Other).toBeUndefined();
    expect(state.unauthorized.Other).toBeUndefined();
  });

  it('Step 3: Reserved Check (Ignore if another protocol explicitly claimed this key)', () => {
    const protocol = createMockProtocol({ namespace: '', permissive: true });
    const interpreter = new ProtocolInterpreter(protocol, parser);
    
    const raw = {
      'Reserved': ['value']
    };

    // Even if we are permissive (Step 4), if it's reserved, we ignore it.
    const state = interpreter.normalize(raw, new Set(['reserved']));
    expect(state.trailers.Reserved).toBeUndefined();
  });

  it('Step 4: Permissive Ingestion (Capture orphans as valid data)', () => {
    const protocol = createMockProtocol({ namespace: '', permissive: true });
    const interpreter = new ProtocolInterpreter(protocol, parser);
    
    const raw = {
      'Orphan': ['value']
    };

    const state = interpreter.normalize(raw);
    expect(state.trailers.Orphan).toEqual(['value']);
    expect(state.unauthorized.Orphan).toBeUndefined();
  });

  it('Step 5: Typo Enforcement (Strict mode fallback for root)', () => {
    const protocol = createMockProtocol({ namespace: '', permissive: false });
    const interpreter = new ProtocolInterpreter(protocol, parser);
    
    const raw = {
      'Typo': ['value']
    };

    const state = interpreter.normalize(raw);
    expect(state.trailers.Typo).toBeUndefined();
    expect(state.unauthorized.Typo).toEqual(['value']);
  });

  it('Step 5: Typo Enforcement (Strict mode fallback for namespaced bucket)', () => {
      // Simulation: We are in a namespaced bucket "Project" (pre-bucketed)
      const protocol = createMockProtocol({ 
          name: 'Project',
          namespace: 'Project',
          permissive: false,
          owns: vi.fn((key: string) => key === 'Id'),
          authorize: vi.fn((key: string) => key === 'Id' ? 'Id' : null)
      });
      const interpreter = new ProtocolInterpreter(protocol, parser);

      const raw = {
          'Id': ['v1'],
          'Tream': ['typo'] // In the bucket but not in schema
      };

      const state = interpreter.normalize(raw);
      expect(state.trailers.Id).toEqual(['v1']);
      expect(state.unauthorized.Tream).toEqual(['typo']);
  });
});
