import { evaluateHygiene, evaluateProtocolSchema, evaluateTrailerHygiene, validateProtocolState } from '../../../..//src/engine/core/logic/validation.js';
import { normalizeTrailers } from '../../../..//src/engine/core/logic/normalization.js';
import { TEST_ENGINE_CONFIG, TEST_PROTOCOL_DEFINITION, MOCK_CORE_TRAILERS, makeMockContext } from '../../../..//src/engine/testing.js';

import { describe, it, expect, vi } from 'vitest';

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

  describe('evaluateProtocolSchema', () => {
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
      
      const issues = evaluateProtocolSchema(protocol as any, state);
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
        
        const issues = evaluateProtocolSchema(protocol as any, state);
        expect(issues.some(i => i.rule === 'required-trailer')).toBe(true);
    });
  });
});