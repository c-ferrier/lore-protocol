import { 
    evaluateHygiene, 
    evaluateProtocolSchema, 
    evaluateTrailerHygiene, 
    validateProtocolState,
    validateProtocolTrailer
} from '../../../../src/engine/core/logic/validation.js';
import { normalizeTrailers } from '../../../../src/engine/core/logic/normalization.js';
import { 
    TEST_ENGINE_CONFIG, 
    TEST_PROTOCOL_DEFINITION, 
    MOCK_CORE_TRAILERS, 
    makeMockContext,
    makeProtocolRegistry
} from '../../../../src/engine/testing.js';

import { describe, it, expect } from 'vitest';

describe('Validation Logic (Pure Functions)', () => {
  describe('evaluateHygiene', () => {
    it('should return no issues for valid hygiene', () => {
      const issues = evaluateHygiene('feat: valid subject', 'Body content.', TEST_ENGINE_CONFIG);
      expect(issues).toHaveLength(0);
    });

    it('should error when subject is empty', () => {
      const issues = evaluateHygiene('', 'Body', TEST_ENGINE_CONFIG);
      expect(issues.some(i => i.rule === 'subject-required')).toBe(true);
    });

    it('should warn when subject exceeds max length', () => {
      const longSubject = 'a'.repeat(TEST_ENGINE_CONFIG.validation.subjectMaxLength + 1);
      const issues = evaluateHygiene(longSubject, 'Body', TEST_ENGINE_CONFIG);
      expect(issues.some(i => i.rule === 'subject-length')).toBe(true);
    });

    it('should warn when message body is too long', () => {
      const longBody = '\n'.repeat(TEST_ENGINE_CONFIG.validation.maxMessageLines + 1);
      const issues = evaluateHygiene('feat: test', longBody, TEST_ENGINE_CONFIG);
      expect(issues.some(i => i.rule === 'message-length')).toBe(true);
    });
  });

  describe('evaluateTrailerHygiene', () => {
    it('should warn when a trailer key appears suspiciously many times', () => {
      const trailers = { 'Constraint': ['1', '2', '3', '4', '5', '6'] };
      const issues = evaluateTrailerHygiene(trailers);
      expect(issues.some(i => i.rule === 'trailer-count')).toBe(true);
    });

    it('should pass for normal trailer counts', () => {
      const trailers = { 'Constraint': ['1', '2', '3'] };
      const issues = evaluateTrailerHygiene(trailers);
      expect(issues).toHaveLength(0);
    });
  });

  describe('validateProtocolState', () => {
    it('should validate protocol state using pure logic', () => {
      const protocol = makeMockContext({ 
          ...TEST_PROTOCOL_DEFINITION 
      });
      const state = { trailers: { 'Mock-id': ['abc12345'] }, unauthorized: {} };

      const issues = validateProtocolState(state, protocol.def);

      expect(issues).toHaveLength(0);
    });

    it('should catch schema violations like invalid enums', () => {
      const protocol = makeMockContext({
          ...TEST_PROTOCOL_DEFINITION,
          trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
      });
      const state = normalizeTrailers({ Confidence: ['invalid-value'] }, protocol);

      const issues = validateProtocolState(state, protocol.def);
      expect(issues.some(i => i.rule === 'invalid-enum')).toBe(true);
    });

    it('should catch missing required trailers in strict mode', () => {
        const protocol = makeMockContext({
            ...TEST_PROTOCOL_DEFINITION,
            strict: true,
            trailers: { 
                Confidence: { description: '', multivalue: false, validation: 'none', required: true }
            }
        });
        const state = normalizeTrailers({ 'Mock-id': ['a1'] }, protocol);

        const issues = validateProtocolState(state, protocol.def);
        expect(issues.some(i => i.rule === 'required-trailer')).toBe(true);
    });
  });

  describe('validateProtocolTrailer', () => {
    const protocol = makeMockContext({ 
        name: 'Mock',
        trailers: { 
            ...TEST_PROTOCOL_DEFINITION.trailers, 
            ...MOCK_CORE_TRAILERS,
            'Internal': { description: '', validation: 'reference', crossProtocol: false } as any
        } 
    });

    it('should validate enum values correctly', () => {
      expect(validateProtocolTrailer('Confidence', 'high', protocol.def).valid).toBe(true);
      expect(validateProtocolTrailer('Confidence', 'junk', protocol.def).valid).toBe(false);
    });

    it('should validate regex patterns correctly', () => {
      expect(validateProtocolTrailer('Mock-id', 'a1b2c3d4', protocol.def).valid).toBe(true);
      expect(validateProtocolTrailer('Mock-id', 'not-hex', protocol.def).valid).toBe(false);
    });

    it('should handle unresolvable cross-protocol references without a registry', () => {
      const result = validateProtocolTrailer('Related', 'other/abc', protocol.def);
      expect(result.valid).toBe(false);
      expect(result.rule).toBe('unknown-protocol-prefix');
    });

    it('should successfully validate a cross-protocol reference when registry is provided', () => {
      const otherProtocol = makeMockContext({ 
          name: 'Other', 
          namespace: 'Other', 
          identityKey: 'Other-id', 
          trailers: {} 
      });
      const registry = makeProtocolRegistry([protocol as any, otherProtocol as any]);

      const result = validateProtocolTrailer('Related', 'other/abc', protocol.def, registry);
      expect(result.valid).toBe(true);
    });

    it('should enforce crossProtocol: false', () => {
        expect(validateProtocolTrailer('Internal', 'other/abc', protocol.def).valid).toBe(false);
        expect(validateProtocolTrailer('Internal', 'abc12345', protocol.def).valid).toBe(true);
    });

    it('should return valid for unknown trailers in permissive mode', () => {
        const permissive = { ...protocol.def, permissive: true };
        expect(validateProtocolTrailer('Random', 'any', permissive).valid).toBe(true);
    });
  });
});