import { describe, expect,it } from 'vitest';

import { getProtocolIdentity } from '../../../src/core/logic/identity.js';
import { getStaleSignals } from '../../../src/core/logic/staleness.js';
import { 
    makeAtom, 
    makeStubProtocolContext, 
    makeStubProtocolMap, 
    makeStubProtocolState,
    normalizeTrailers,
    TEST_PROTOCOL_DEFINITION 
} from '../../../src/testing.js';

describe('Protocol Interpreter Logic (via Pure Functions)', () => {

  it('should normalize raw trailers into authorized and unauthorized buckets', () => {
    const protocol = makeStubProtocolContext({ ...TEST_PROTOCOL_DEFINITION, permissive: false });
    
    const raw = {
      'Mock-id': ['a1b2c3d4'],
      'Unknown': ['junk']
    };

    const state = normalizeTrailers(raw, protocol);
    expect(state.trailers['Mock-id']).toEqual(['a1b2c3d4']);
    expect(state.unauthorized['Unknown']).toEqual(['junk']);
  });

  it('should ingest unknown trailers in permissive mode', () => {
    const protocol = makeStubProtocolContext({ ...TEST_PROTOCOL_DEFINITION, permissive: true, strict: false });
    const raw = { 'Unknown': ['value'] };

    const state = normalizeTrailers(raw, protocol);
    expect(state.trailers['Unknown']).toEqual(['value']);
    expect(state.unauthorized).toEqual({});
  });

  it('should handle namespaced trailers when configured', () => {
    const protocol = makeStubProtocolContext({ 
        ...TEST_PROTOCOL_DEFINITION, 
        namespace: 'Project',
        permissive: false,
        trailers: { id: { description: 'ID', multivalue: false, validation: 'none' } }
    });
    
    const raw = {
      'Project': ['id: 12345678', 'team: backend']
    };

    const state = normalizeTrailers(raw, protocol);
    expect(state.trailers.id).toEqual(['12345678']);
    expect(state.unauthorized.team).toEqual(['backend']);
  });

  it('should extract identity from protocol state', () => {
    const protocol = makeStubProtocolContext(TEST_PROTOCOL_DEFINITION);
    
    const state = makeStubProtocolState({
      trailers: { 'Mock-id': ['a1b2c3d4'] }
    });

    expect(getProtocolIdentity(state, protocol)).toBe('a1b2c3d4');
    expect(getProtocolIdentity(null, protocol)).toBeNull();
  });

  it('should handle namespaced trailers with invalid formats by putting them in unauthorized bucket', () => {
    const protocol = makeStubProtocolContext({ ...TEST_PROTOCOL_DEFINITION, namespace: 'Project' });
    
    const raw = {
      'Project': ['this is not a key-value pair']
    };

    const state = normalizeTrailers(raw, protocol);
    expect(state.unauthorized['invalid-format']).toEqual(['this is not a key-value pair']);
  });

  it('should respect claimed keys in permissive mode', () => {
    const protocol = makeStubProtocolContext({ ...TEST_PROTOCOL_DEFINITION, permissive: true, strict: false });
    
    const raw = {
      'Other': ['value']
    };

    const state = normalizeTrailers(raw, protocol, new Set(['Other']));
    expect(state.trailers.Other).toBeUndefined();
  });

  it('should normalize mixed-case trailers to canonical keys', () => {
    const protocol = makeStubProtocolContext({ 
        ...TEST_PROTOCOL_DEFINITION, 
        trailers: { Confidence: { description: 'C', multivalue: false, validation: 'none' } }
    });
    
    const raw = {
      'confidence': ['high'],
      'CONFIDENCE': ['low']
    };

    const state = normalizeTrailers(raw, protocol);
    expect(state.trailers.Confidence).toEqual(['high', 'low']);
  });

  describe('getStaleSignals (Declarative Triggers)', () => {
    it('should evaluate "value-equals" condition', () => {
      const protocol = makeStubProtocolContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: {
          Confidence: {
            description: 'C',
            multivalue: false,
            validation: 'none',
            stale_if: { kind: 'value-equals', value: 'low', signal: 'low-conf' }
          }
        }
      });
      
      const atom = makeAtom({
        protocols: makeStubProtocolMap([['mock', makeStubProtocolState({ trailers: { Confidence: ['low'] } })]])
      });

      const signals = getStaleSignals(protocol, atom, new Date(), new Map());
      expect(signals).toHaveLength(1);
      expect(signals[0].signal).toBe('low-conf');
      expect(signals[0].description).toContain('marked as Confidence: low');
    });

    it('should evaluate "date-expired" condition', () => {
      const protocol = makeStubProtocolContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: {
          Deadline: {
            description: 'D',
            multivalue: false,
            validation: 'none',
            stale_if: { kind: 'date-expired', signal: 'expired-hint' }
          }
        }
      });
      
      const atom = makeAtom({
        protocols: makeStubProtocolMap([['mock', makeStubProtocolState({ trailers: { Deadline: ['[until: 2024-01-01]'] } })]])
      });

      const later = new Date('2024-02-01');
      const signals = getStaleSignals(protocol, atom, later, new Map());
      expect(signals).toHaveLength(1);
      expect(signals[0].signal).toBe('expired-hint');
    });

    it('should evaluate "reference-superseded" condition', () => {
      const protocol = makeStubProtocolContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: {
          Ref: {
            description: 'R',
            multivalue: false,
            validation: 'reference',
            stale_if: { kind: 'reference-superseded', signal: 'orphaned-dep' }
          }
        }
      });
      
      const atom = makeAtom({
        protocols: makeStubProtocolMap([['mock', makeStubProtocolState({ trailers: { 'Mock-id': ['a1b2c3d4'], Ref: ['old-id'] } })]])
      });

      const globalMap = new Map([
        ['mock', new Map([['old-id', { superseded: true, supersededBy: ['new-id'] }]])]
      ]);

      const signals = getStaleSignals(protocol, atom, new Date(), globalMap);
      expect(signals).toHaveLength(1);
      expect(signals[0].signal).toBe('orphaned-dep');
      expect(signals[0].description).toContain('superseded by new-id');
    });

    it('should NOT evaluate "reference-superseded" if the target is superseded by the atom itself', () => {
        const protocol = makeStubProtocolContext({
            ...TEST_PROTOCOL_DEFINITION,
            trailers: {
              Ref: {
                description: 'R',
                multivalue: false,
                validation: 'reference',
                stale_if: { kind: 'reference-superseded', signal: 'orphaned-dep' }
              }
            }
          });
          
          // Use a valid hex ID so isValidIdentity passes
          const validId = 'abcdef12';
          const atom = makeAtom({
            protocols: makeStubProtocolMap([['mock', makeStubProtocolState({ trailers: { 'Mock-id': [validId], Ref: ['old-id'] } })]])
          });
    
          const globalMap = new Map([
            ['mock', new Map([['old-id', { superseded: true, supersededBy: [validId] }]])]
          ]);
    
          const signals = getStaleSignals(protocol, atom, new Date(), globalMap);
          expect(signals).toHaveLength(0);
    });
  });
});
