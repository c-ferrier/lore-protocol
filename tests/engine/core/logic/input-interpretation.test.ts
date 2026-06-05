import { InputMode, finalizeCommitInput, parseFlagsToInput, selectInputMode } from '../../../..//src/engine/core/logic/input-interpretation.js';
import { ProtocolRegistry } from '../../../..//src/engine/services/protocol-registry.js';
import { TEST_ENGINE_CONFIG, TEST_PROTOCOL_DEFINITION, MOCK_CORE_TRAILERS, makeMockContext } from '../../../..//src/engine/testing.js';

import { describe, it, expect, beforeEach } from 'vitest';

describe('Input Interpretation Logic (Pure Functions)', () => {
  let registry: ProtocolRegistry;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    registry.register(makeMockContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
    }));
  });

  describe('selectInputMode', () => {
    it('should prioritize interactive flag', () => {
      const mode = selectInputMode({ interactive: true, file: 'test.json', subject: 'test' });
      expect(mode).toBe(InputMode.Interactive);
    });

    it('should prioritize file flag over other options', () => {
      const mode = selectInputMode({ file: 'test.json', subject: 'test' });
      expect(mode).toBe(InputMode.File);
    });

    it('should select flags mode if any intent-related flag is present', () => {
      const mode = selectInputMode({ subject: 'test' });
      expect(mode).toBe(InputMode.Flags);
    });

    it('should fallback to stdin for empty options (non-interactive default)', () => {
        const mode = selectInputMode({});
        expect(mode).toBe(InputMode.Stdin);
    });

    it('should NOT trigger flags mode for whitelisted background flags (like updateNotifier)', () => {
        const mode = selectInputMode({ updateNotifier: false });
        expect(mode).toBe(InputMode.Stdin);
    });
  });

  describe('parseFlagsToInput', () => {
    it('should map flat flags to protocol trailers', () => {
      const input = parseFlagsToInput({ 
          subject: 'feat: add login',
          confidence: 'high' // slugified key for 'Confidence'
      }, registry);

      expect(input.subject).toBe('feat: add login');
      expect(input.trailers?.get('mock')?.['Confidence']).toEqual(['high']);
    });

    it('should support explicit catch-all --trailer flags', () => {
        const input = parseFlagsToInput({ 
            trailer: ['Confidence=medium', 'Constraint=rule1']
        }, registry);

        expect(input.trailers?.get('mock')?.['Confidence']).toEqual(['medium']);
        expect(input.trailers?.get('mock')?.['Constraint']).toEqual(['rule1']);
    });

    it('should support qualified namespaced trailers', () => {
        registry.register(makeMockContext({ 
            name: 'Alpha', 
            namespace: 'alpha', 
            identityKey: 'A-id',
            trailers: { 'Status': { description: 'S', multivalue: false, validation: 'none' } as any }
        }));
        const input = parseFlagsToInput({ 
            trailer: ['alpha/A-id=abc', 'alpha/Status=active']
        }, registry);

        expect(input.trailers?.get('alpha')?.['A-id']).toEqual(['abc']);
        expect(input.trailers?.get('alpha')?.['Status']).toEqual(['active']);
    });
  });

  describe('finalizeCommitInput', () => {
    it('should apply defaults and ensure non-null fields', () => {
      const input = finalizeCommitInput({ subject: 'test' }, TEST_ENGINE_CONFIG);
      expect(input.subject).toBe('test');
      expect(input.body).toBe('');
      expect(input.trailers).toBeDefined();
    });
  });
});