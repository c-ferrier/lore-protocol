import { createTrailerCollectors } from '../../../../src/engine/cli/readers/collectors/trailer-collector-registry.js';
import { InteractiveInputReader } from '../../../../src/engine/cli/readers/interactive-input-reader.js';
import { TEST_PROTOCOL_DEFINITION, MOCK_CORE_TRAILERS, makeProtocol } from '../../../../src/engine/testing.js';
import { makeMockPrompt } from '../../engine-test-utils.js';

import { describe, it, expect, vi } from 'vitest';

describe('InteractiveInputReader', () => {
  const CORE_SCHEMA = {
      ...TEST_PROTOCOL_DEFINITION.trailers,
      ...MOCK_CORE_TRAILERS
  };

  describe('full flow', () => {
    it('should collect all fields when user accepts everything', async () => {
      let confirmCallIndex = 0;
      const confirmResponses = [
        true,   // Add a body?
        true,   // Add a Constraint? (yes)
        false,  // Add another Constraint? (no)
        true,   // Set Confidence?
        true,   // Add a Related? (yes)
        false,  // Add another Related? (no)
      ];

      let textCallIndex = 0;
      const textResponses = [
        'refactor auth module',   // subject
        'must be fast',           // Constraint value
        'beef1234',               // Related value
      ];

      let choiceCallIndex = 0;
      const choiceResponses = ['high'];

      const prompt = makeMockPrompt({
        askText: vi.fn().mockImplementation(() => {
          const response = textResponses[textCallIndex] ?? '';
          textCallIndex++;
          return Promise.resolve(response);
        }),
        askMultiline: vi.fn().mockResolvedValue('This is the body text.'),
        askConfirm: vi.fn().mockImplementation(() => {
          const response = confirmResponses[confirmCallIndex] ?? false;
          confirmCallIndex++;
          return Promise.resolve(response);
        }),
        askChoice: vi.fn().mockImplementation(() => {
          const response = choiceResponses[choiceCallIndex] ?? 'low';
          choiceCallIndex++;
          return Promise.resolve(response);
        }),
        close: vi.fn(),
      });

      const reader = new InteractiveInputReader(prompt, createTrailerCollectors(makeProtocol({ trailers: CORE_SCHEMA })));
      const result = await reader.read();

      expect(result.subject).toBe('refactor auth module');
      expect(result.body).toBe('This is the body text.');
      expect(result.trailers.get('mock').Constraint).toEqual(['must be fast']);
      expect(result.trailers.get('mock').Confidence).toEqual(['high']);
      expect(result.trailers.get('mock').Related).toEqual(['beef1234']);
      expect(prompt.close).toHaveBeenCalled();
    });
  });

  describe('minimal flow', () => {
    it('should return subject only when user declines everything', async () => {
      const prompt = makeMockPrompt({
        askText: vi.fn().mockResolvedValue('minimal subject'),
        askConfirm: vi.fn().mockResolvedValue(false),
        close: vi.fn(),
      });

      const reader = new InteractiveInputReader(prompt, createTrailerCollectors(makeProtocol({ trailers: CORE_SCHEMA })));
      const result = await reader.read();

      expect(result.subject).toBe('minimal subject');
      expect(result.body).toBeUndefined();
      expect(result.trailers.size).toBe(0);
      expect(prompt.close).toHaveBeenCalled();
    });
  });

  describe('multiple values collection', () => {
    it('should collect multiple constraints', async () => {
      let confirmCallIndex = 0;
      const confirmResponses = [
        false,  // Add a body? (no)
        true,   // Add a Constraint? (yes)
        true,   // Add another Constraint? (yes)
        true,   // Add another Constraint? (yes)
        false,  // Add another Constraint? (no)
        false,  // Set Confidence? (no)
        false,  // Add a Related? (no)
      ];

      let textCallIndex = 0;
      const textResponses = [
        'test subject',          // subject
        'constraint one',       // first constraint
        'constraint two',       // second constraint
        'constraint three',     // third constraint
      ];

      const prompt = makeMockPrompt({
        askText: vi.fn().mockImplementation(() => {
          const response = textResponses[textCallIndex] ?? '';
          textCallIndex++;
          return Promise.resolve(response);
        }),
        askConfirm: vi.fn().mockImplementation(() => {
          const response = confirmResponses[confirmCallIndex] ?? false;
          confirmCallIndex++;
          return Promise.resolve(response);
        }),
        close: vi.fn(),
      });

      const reader = new InteractiveInputReader(prompt, createTrailerCollectors(makeProtocol({ trailers: CORE_SCHEMA })));
      const result = await reader.read();

      expect(result.trailers.get('mock').Constraint).toEqual([
        'constraint one',
        'constraint two',
        'constraint three',
      ]);
    });
  });
});