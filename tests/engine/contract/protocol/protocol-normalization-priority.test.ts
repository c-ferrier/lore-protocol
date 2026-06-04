import { ProtocolInterpreter, makeProtocol } from '../../../../src/engine/testing.js';
import { makeMockProtocol } from '../../engine-test-utils.js';

import { describe, it, expect, vi } from 'vitest';
;
;

describe('ProtocolInterpreter Normalization Priority Matrix', () => {

  it('Step 1: Explicit Ownership should always win', () => {
    const protocol = makeProtocol({ 
        name: 'Mock',
        permissive: true,
        trailers: { 'Owned': { description: 'D' } }
    });
    const interpreter = new ProtocolInterpreter(protocol);
    
    // Even if it looks like a namespace (Step 2) or is reserved (Step 3),
    // if we explicitly own it in our schema, we take it.
    const raw = {
      'Owned': ['value']
    };

    const state = interpreter.normalize(raw, new Set(['Owned'])); // Reserved by others
    expect(state.trailers.Owned).toEqual(['value']);
    expect(state.unauthorized).toEqual({});
  });

  it('Step 2: Orphan Capture (Root Protocol ingests unrecognized namespaces)', () => {
    const protocol = makeMockProtocol({ namespace: '', permissive: true });
    const interpreter = protocol;
    
    const raw = {
      'Other': ['Key: value'] // Qualified trailer with no matching protocol
    };

    const state = interpreter.normalize(raw);
    // Root protocol should capture this as a custom trailer because it is permissive
    expect(state.trailers.Other).toEqual(['Key: value']);
    expect(state.unauthorized.Other).toBeUndefined();
  });

  it('Step 2a: Orphan Rejection (Strict Root Protocol marks unrecognized namespaces as unauthorized)', () => {
    const protocol = makeMockProtocol({ namespace: '', permissive: false });
    const interpreter = protocol;
    
    const raw = {
      'Other': ['Key: value'] 
    };

    const state = interpreter.normalize(raw);
    // Root protocol should mark this as unauthorized because it is NOT permissive
    expect(state.trailers.Other).toBeUndefined();
    expect(state.unauthorized.Other).toEqual(['Key: value']);
  });

  it('Step 3: Reserved Check (Ignore if another protocol explicitly claimed this key)', () => {
    const protocol = makeMockProtocol({ namespace: '', permissive: true });
    const interpreter = protocol;
    
    const raw = {
      'Reserved': ['value']
    };

    // Even if we are permissive (Step 4), if it's reserved, we ignore it.
    const state = interpreter.normalize(raw, new Set(['reserved']));
    expect(state.trailers.Reserved).toBeUndefined();
  });

  it('Step 4: Permissive Ingestion (Capture orphans as valid data)', () => {
    const protocol = makeProtocol({ name: 'Root', namespace: '', permissive: true });
    const interpreter = new ProtocolInterpreter(protocol);
    
    const raw = {
      'Orphan': ['value']
    };

    const state = interpreter.normalize(raw);
    expect(state.trailers.Orphan).toEqual(['value']);
    expect(state.unauthorized.Orphan).toBeUndefined();
  });

  it('Step 5: Typo Enforcement (Strict mode fallback for root)', () => {
    const protocol = makeProtocol({ name: 'Root', namespace: '', permissive: false });
    const interpreter = new ProtocolInterpreter(protocol);
    
    const raw = {
      'Typo': ['value']
    };

    const state = interpreter.normalize(raw);
    expect(state.trailers.Typo).toBeUndefined();
    expect(state.unauthorized.Typo).toEqual(['value']);
  });

  it('Step 5: Typo Enforcement (Strict mode fallback for namespaced bucket)', () => {
      // Simulation: We are in a namespaced bucket "Project" (pre-bucketed)
      const nsProtocol = makeProtocol({ 
          name: 'Project',
          namespace: 'Project',
          permissive: false,
          trailers: { 'Id': { description: 'ID' } }
      }, { strict: true, permissive: false } as any);
      const interpreter = new ProtocolInterpreter(nsProtocol);

      // Namespaced protocols strictly validate INSIDE their bucket
      const raw = {
          'Project': ['Id: v1', 'Tream: typo']
      };

      const state = interpreter.normalize(raw);
      expect(state.trailers.Id).toEqual(['v1']);
      expect(state.unauthorized.Tream).toEqual(['typo']);
  });
});
