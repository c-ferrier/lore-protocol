import { describe, expect,it } from 'vitest';

import { validateProtocolState, validateProtocolTrailer } from '../../../../src/engine/core/logic/validation.js';
import { makeStubProtocolContext, makeStubProtocolState, TEST_ID_KEY, TEST_PROTOCOL_DEFINITION } from '../../../../src/engine/testing.js';

describe('ProtocolValidator', () => {
  it('should report missing required trailers as errors in strict mode', () => {
    const protocol = makeStubProtocolContext({ 
        strict: true, 
        trailers: { 
            [TEST_ID_KEY]: TEST_PROTOCOL_DEFINITION.trailers[TEST_ID_KEY],
            'Confidence': { description: 'C', multivalue: false, validation: 'none', required: true } 
        } 
    });
    
    const state = makeStubProtocolState({
        trailers: {}
    });

    const issues = validateProtocolState(state, protocol.def);
    const idIssue = issues.find(i => i.field === TEST_ID_KEY);
    const confIssue = issues.find(i => i.field === 'Confidence');

    expect(idIssue?.severity).toBe('error');
    expect(idIssue?.rule).toBe('mock-id-present');
    expect(confIssue?.severity).toBe('error');
  });

  it('should report missing optional required trailers as warnings in non-strict mode', () => {
    const protocol = makeStubProtocolContext({ 
        strict: false, 
        trailers: { 
            [TEST_ID_KEY]: TEST_PROTOCOL_DEFINITION.trailers[TEST_ID_KEY],
            'Confidence': { description: 'C', multivalue: false, validation: 'none', required: true } 
        } 
    });
    
    const state = makeStubProtocolState({
        trailers: {}
    });

    const issues = validateProtocolState(state, protocol.def);
    const idIssue = issues.find(i => i.field === TEST_ID_KEY);
    const confIssue = issues.find(i => i.field === 'Confidence');

    // Identity is ALWAYS an error if missing
    expect(idIssue?.severity).toBe('error');
    // Other required trailers are warnings in non-strict
    expect(confIssue?.severity).toBe('warning');
  });

  it('should validate enum values', () => {
    const protocol = makeStubProtocolContext({ 
        trailers: { Confidence: { description: 'C', multivalue: false, validation: 'values' as const, values: { high: { description: 'H' } } } }
    });

    const validResult = validateProtocolTrailer('Confidence', 'high', protocol.def);
    expect(validResult.valid).toBe(true);

    const invalidResult = validateProtocolTrailer('Confidence', 'junk', protocol.def);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.rule).toBe('invalid-enum');
  });

  it('should report unauthorized trailers in non-permissive mode', () => {
    const protocol = makeStubProtocolContext({ permissive: false });

    const state = makeStubProtocolState({
        trailers: { [TEST_ID_KEY]: ['abc'] },
        unauthorized: { 'Typo': ['val'] }
    });

    const issues = validateProtocolState(state, protocol.def);
    const typoIssue = issues.find(i => i.field === 'Typo');

    expect(typoIssue).toBeDefined();
    expect(typoIssue?.severity).toBe('error');
    expect(typoIssue?.rule).toBe('unauthorized-trailer');
  });

  it('should validate pattern formats', () => {
    const protocol = makeStubProtocolContext({
        trailers: { Id: { description: 'D', multivalue: false, validation: 'pattern' as const, pattern: '^[0-9]+$' } }
    });

    const validResult = validateProtocolTrailer('Id', '12345', protocol.def);
    expect(validResult.valid).toBe(true);

    const invalidResult = validateProtocolTrailer('Id', 'abcde', protocol.def);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.rule).toBe('invalid-format');
  });

  it('should validate local reference formats without a registry', () => {
    const protocol = makeStubProtocolContext({
        trailers: { 
            [TEST_ID_KEY]: TEST_PROTOCOL_DEFINITION.trailers[TEST_ID_KEY],
            Ref: { description: 'R', multivalue: true, validation: 'reference' as const } 
        }
    });

    // Local ref (no prefix)
    expect(validateProtocolTrailer('Ref', 'a1b2c3d4', protocol.def).valid).toBe(true);
    // Identity check is now strict, and 'junk' is not 8-char hex
    expect(validateProtocolTrailer('Ref', 'junk', protocol.def).valid).toBe(false);

    // Explicit local ref (with prefix matching name)
    expect(validateProtocolTrailer('Ref', 'mock/a1b2c3d4', protocol.def).valid).toBe(true);
  });

  it('should enforce boundary rules (crossProtocol: false)', () => {
    const protocol = makeStubProtocolContext({
        name: 'Strict',
        trailers: { Ref: { description: 'R', multivalue: true, validation: 'reference' as const, crossProtocol: false } }
    });

    // Cross-protocol ref to 'other' -> prohibited
    const result = validateProtocolTrailer('Ref', 'other/123', protocol.def);
    expect(result.valid).toBe(false);
    expect(result.rule).toBe('cross-protocol-prohibited');
  });
});
