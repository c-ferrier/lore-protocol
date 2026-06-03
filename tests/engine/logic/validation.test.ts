import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateHygiene, evaluateProtocolSchema, evaluateTrailerHygiene } from '../../../src/engine/logic/validation.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { 
    TEST_ENGINE_CONFIG, 
    TEST_PROTOCOL_DEFINITION, 
    makeProtocol 
} from '../engine-test-utils.js';

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
    it('should delegate to protocol.validateState', () => {
      const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
      const state = protocol.parse('Mock-id: abc12345');
      const spy = vi.spyOn(protocol, 'validateState');
      
      evaluateProtocolSchema(protocol, state);
      
      expect(spy).toHaveBeenCalledWith(state);
    });

    it('should catch schema violations like invalid enums', () => {
      const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
      const state = protocol.parse('Confidence: invalid-value', undefined, true);
      
      const issues = evaluateProtocolSchema(protocol, state);
      expect(issues.some(i => i.rule === 'invalid-enum')).toBe(true);
    });

    it('should catch missing required trailers in strict mode', () => {
        const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION, {
            strict: true,
            trailers: { 
                Confidence: { description: '', multivalue: false, validation: 'none', required: true }
            }
        });
        const state = protocol.normalize({ 'Mock-id': ['a1'] });
        
        const issues = evaluateProtocolSchema(protocol, state);
        expect(issues.some(i => i.rule === 'required-trailer')).toBe(true);
    });
  });
});
