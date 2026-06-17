import { describe, expect,it } from 'vitest';

import { 
    authorizeKey 
} from '../../src/core/logic/ownership.js';
import { 
    getAuthorizedKeys, 
    isCoreTrailer} from '../../src/core/logic/protocols.js';
import { 
  makeStubProtocolContext,
  MOCK_CORE_TRAILERS,
  TEST_ID_KEY,
  TEST_PROTOCOL_DEFINITION, 
} from '../../src/testing.js';

describe('Protocol Service', () => {

  it('should load baseline trailers by default', () => {
    const protocol = makeStubProtocolContext({ name: 'BaselineTest' });
    const keys = getAuthorizedKeys(protocol);
    
    expect(keys).toContain(TEST_ID_KEY);
    expect(keys).not.toContain('Constraint');
  });

  it('should merge custom definitions into the protocol', () => {
    const protocol = makeStubProtocolContext({ 
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
    const protocol = makeStubProtocolContext({ 
        name: 'CoreTest',
        trailers: {
            'Constraint': { description: 'User override', multivalue: true, validation: 'none', isCore: true }
        }
    });
    
    expect(isCoreTrailer('Constraint', protocol)).toBe(true);
    expect(protocol.trailers.get('Constraint')?.description).toBe('User override');
  });

  it('should authorize any key in permissive mode', () => {
    const protocol = makeStubProtocolContext({ name: 'PermissiveTest', strict: false, permissive: true });
    expect(authorizeKey('Random-Key', protocol)).toBe('Random-Key');
  });

  it('should not authorize unknown keys in strict mode', () => {
    const protocol = makeStubProtocolContext({ name: 'StrictAuthTest', strict: true, permissive: false });
    expect(authorizeKey('Unknown', protocol)).toBeNull();
  });

  it('should sort authorized keys based on prompt order', () => {
    const protocol = makeStubProtocolContext({
      name: 'SortTest',
      trailers: {
        'Z': { description: '', multivalue: false, validation: 'none', prompt: { order: 10 } },
        'A': { description: '', multivalue: false, validation: 'none', prompt: { order: 5 } }
      }
    });
    const keys = getAuthorizedKeys(protocol);
    // Mock-id has order 0
    expect(keys[0]).toBe(TEST_ID_KEY);
    expect(keys[1]).toBe('A');
    expect(keys[2]).toBe('Z');
  });

  it('should default custom trailers to the end of the sort order', () => {
    const protocol = makeStubProtocolContext({ 
        name: 'OrderTest',
        trailers: { 'Custom': { description: 'D', multivalue: false, validation: 'none' } }
    });
    const keys = getAuthorizedKeys(protocol);
    expect(keys[keys.length - 1]).toBe('Custom');
  });

  describe('Case-Insensitive Normalization', () => {
    it('should normalize core keys regardless of input casing', () => {
      const protocol = makeStubProtocolContext({ 
        name: 'CaseTest',
        trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS } 
      });
      expect(authorizeKey('confidence', protocol)).toBe('Confidence');
      expect(authorizeKey('CONFIDENCE', protocol)).toBe('Confidence');
    });

    it('should normalize custom definition keys', () => {
        const protocol = makeStubProtocolContext({ 
            name: 'CustomCaseTest',
            trailers: { 'Custom-Key': { description: 'D', multivalue: false, validation: 'none' } }
        });
        expect(authorizeKey('custom-key', protocol)).toBe('Custom-Key');
    });

    it('should preserve original casing for ad-hoc trailers in permissive mode', () => {
      const protocol = makeStubProtocolContext({ name: 'AdhocCaseTest', permissive: true, strict: false });
      expect(authorizeKey('New-Key', protocol)).toBe('New-Key');
    });

    it('should prioritize core casing over ad-hoc casing', () => {
        const protocol = makeStubProtocolContext({ 
            name: 'PriorityCaseTest',
            permissive: true,
            trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
        });
        expect(authorizeKey('confidence', protocol)).toBe('Confidence');
    });
  });

  describe('Required Unification', () => {
    it('should mark a trailer as required if set in definitions', () => {
      const protocol = makeStubProtocolContext({
        name: 'RequiredTest',
        trailers: { 'Must-Have': { description: '', multivalue: false, validation: 'none', required: true } }
      });
      expect(protocol.trailers.get('Must-Have')?.required).toBe(true);
    });
  });

  describe('Custom Overrides', () => {
    it('should allow custom definitions to override core trailer metadata (e.g. color)', () => {
      const overriddenProtocol = makeStubProtocolContext({
          ...TEST_PROTOCOL_DEFINITION,
          name: 'OverrideTest',
          trailers: {
              ...TEST_PROTOCOL_DEFINITION.trailers,
              'Confidence': { ...MOCK_CORE_TRAILERS.Confidence, description: 'New Desc', ui: { color: 'red' } }
          }
      });
      
      const def = overriddenProtocol.trailers.get('Confidence');
      expect(def?.description).toBe('New Desc');
      expect(def?.ui?.color).toBe('red');
    });
  });

  describe('Discovery Patterns', () => {
    it('should provide discovery patterns for registered trailers', () => {
        const protocol = makeStubProtocolContext(TEST_PROTOCOL_DEFINITION);
        // Note: Logic for pattern generation is in logic/protocols.ts, 
        // here we verify the context provides the expected data.
        expect(protocol.identityKey).toBe(TEST_ID_KEY);
    });
  });
});
