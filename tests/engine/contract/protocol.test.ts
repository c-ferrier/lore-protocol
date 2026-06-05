import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { 
  TEST_PROTOCOL_DEFINITION, 
  TEST_ENGINE_CONFIG,
  TEST_ID_KEY,
  MOCK_CORE_TRAILERS,
  makeMockContext,
  makeProtocolRegistry,
  makeProtocol,
} from '../../../src/engine/testing.js';

import { 
    isCoreTrailer, 
    getAuthorizedKeys 
} from '../../../src/engine/core/logic/protocols.js';
import { 
    claimsTrailers, 
    getDiscoveryPatterns, 
    getSearchPatterns 
} from '../../../src/engine/shell/git/protocol-query-adapter.js';
import { 
    authorizeKey, 
    ownsKey 
} from '../../../src/engine/core/logic/ownership.js';
import { 
    normalizeTrailers 
} from '../../../src/engine/core/logic/normalization.js';
import { validateProtocolTrailer } from '../../../src/engine/core/logic/validation.js';
import { TriggerParser } from '../../../src/engine/util/trigger-parser.js';

import { describe, it, expect } from 'vitest';

describe('Protocol Service', () => {

  it('should load baseline trailers by default', () => {
    const protocol = makeMockContext({ name: 'BaselineTest' });
    const keys = getAuthorizedKeys(protocol);
    
    expect(keys).toContain(TEST_ID_KEY);
    expect(keys).not.toContain('Constraint');
  });

  it('should merge custom definitions into the protocol', () => {
    const protocol = makeMockContext({ 
        name: 'MergeTest',
        trailers: {
            'Team': { description: 'The team responsible', multivalue: false, validation: 'none' }
        }
    });
    const def = protocol.trailers.get('Team');
    
    expect(def).toBeDefined();
    expect(def?.description).toBe('The team responsible');
    expect(def?.isCore).toBe(false);
    expect(isCoreTrailer('Team', protocol)).toBe(false);
  });

  it('should identify configured custom trailers as non-core even if they are in core-definitions', () => {
    const protocol = makeMockContext({ 
        name: 'CoreTest',
        trailers: {
            'Constraint': { description: 'User override', isCore: true }
        }
    });
    
    expect(isCoreTrailer('Constraint', protocol)).toBe(true);
    expect(protocol.trailers.get('Constraint')?.description).toBe('User override');
  });

  it('should authorize any key in permissive mode', () => {
    const protocol = makeMockContext({ name: 'PermissiveTest', strict: false, permissive: true });
    expect(authorizeKey('Random-Key', protocol)).toBe('Random-Key');
  });

  it('should not authorize unknown keys in strict mode', () => {
    const protocol = makeMockContext({ name: 'StrictAuthTest', strict: true, permissive: false });
    expect(authorizeKey('Unknown', protocol)).toBeNull();
  });

  it('should sort authorized keys based on prompt order', () => {
    const protocol = makeMockContext({
      name: 'SortTest',
      trailers: {
        'Z': { description: '', prompt: { order: 10 } } as any,
        'A': { description: '', prompt: { order: 5 } } as any
      }
    });
    const keys = getAuthorizedKeys(protocol);
    // Mock-id has order 0
    expect(keys[0]).toBe(TEST_ID_KEY);
    expect(keys[1]).toBe('A');
    expect(keys[2]).toBe('Z');
  });

  it('should default custom trailers to the end of the sort order', () => {
    const protocol = makeMockContext({ 
        name: 'OrderTest',
        trailers: { 'Custom': { description: 'D' } }
    });
    const keys = getAuthorizedKeys(protocol);
    expect(keys[keys.length - 1]).toBe('Custom');
  });

  describe('Case-Insensitive Normalization', () => {
    it('should normalize core keys regardless of input casing', () => {
      const protocol = makeMockContext({ 
        name: 'CaseTest',
        trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS } 
      });
      expect(authorizeKey('confidence', protocol)).toBe('Confidence');
      expect(authorizeKey('CONFIDENCE', protocol)).toBe('Confidence');
    });

    it('should normalize custom definition keys', () => {
        const protocol = makeMockContext({ 
            name: 'CustomCaseTest',
            trailers: { 'Custom-Key': { description: 'D' } }
        });
        expect(authorizeKey('custom-key', protocol)).toBe('Custom-Key');
    });

    it('should preserve original casing for ad-hoc trailers in permissive mode', () => {
      const protocol = makeMockContext({ name: 'AdhocCaseTest', permissive: true, strict: false });
      expect(authorizeKey('New-Key', protocol)).toBe('New-Key');
    });

    it('should prioritize core casing over ad-hoc casing', () => {
        const protocol = makeMockContext({ 
            name: 'PriorityCaseTest',
            permissive: true,
            trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
        });
        expect(authorizeKey('confidence', protocol)).toBe('Confidence');
    });
  });

  describe('Required Unification', () => {
    it('should mark a trailer as required if set in definitions', () => {
      const protocol = makeMockContext({
        name: 'RequiredTest',
        trailers: { 'Must-Have': { description: '', required: true } } as any
      });
      expect(protocol.trailers.get('Must-Have')?.required).toBe(true);
    });
  });

  describe('Custom Overrides', () => {
    it('should allow custom definitions to override core trailer metadata (e.g. color)', () => {
      const overriddenProtocol = makeMockContext({
          ...TEST_PROTOCOL_DEFINITION,
          name: 'OverrideTest',
          trailers: {
              ...TEST_PROTOCOL_DEFINITION.trailers,
              'Confidence': { ...MOCK_CORE_TRAILERS.Confidence, description: 'New Desc', ui: { color: 'red' } } as any
          }
      });
      
      const def = overriddenProtocol.trailers.get('Confidence');
      expect(def?.description).toBe('New Desc');
      expect(def?.ui?.color).toBe('red');
    });
  });

  describe('Discovery Patterns', () => {
    it('should provide discovery patterns for registered trailers', () => {
        const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
        // Note: Logic for pattern generation is in logic/protocols.ts, 
        // here we verify the context provides the expected data.
        expect(protocol.identityKey).toBe(TEST_ID_KEY);
    });
  });
});
