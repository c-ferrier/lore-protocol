import { makeMockPrompt } from '../../../engine-test-utils.js';
import { describe, it, expect, vi } from 'vitest';
import { EnumChoiceTrailerCollector } from '../../../../../src/engine/services/readers/collectors/enum-choice-trailer-collector.js';

describe('EnumChoiceTrailerCollector', () => {
  it('should return undefined when user declines', async () => {
    const prompt = makeMockPrompt({
      askConfirm: vi.fn().mockResolvedValue(false)
    });

    const collector = new EnumChoiceTrailerCollector({
      key: 'Confidence',
      confirmMessage: 'Set Confidence?',
      choiceMessage: 'Confidence:',
      values: ['low', 'medium', 'high'],
    });

    const result = await collector.collect(prompt);

    expect(result).toEqual({ key: 'Confidence', value: undefined });
    expect(prompt.askConfirm).toHaveBeenCalled();
  });

  it('should return chosen value when user accepts', async () => {
    const prompt = makeMockPrompt({
      askConfirm: vi.fn().mockResolvedValue(true),
      askChoice: vi.fn().mockResolvedValue('medium')
    });

    const collector = new EnumChoiceTrailerCollector({
      key: 'Confidence',
      confirmMessage: 'Set Confidence?',
      choiceMessage: 'Confidence:',
      values: ['low', 'medium', 'high'],
    });

    const result = await collector.collect(prompt);

    expect(result).toEqual({ key: 'Confidence', value: 'medium' });
    expect(prompt.askChoice).toHaveBeenCalled();
  });

  it('should pass correct messages and values to prompt', async () => {
    const prompt = makeMockPrompt({
      askConfirm: vi.fn().mockResolvedValue(true),
      askChoice: vi.fn().mockResolvedValue('high')
    });

    const collector = new EnumChoiceTrailerCollector({
      key: 'Confidence',
      confirmMessage: 'Set Confidence?',
      choiceMessage: 'Confidence:',
      values: ['low', 'medium', 'high'],
    });

    await collector.collect(prompt);

    expect(prompt.askConfirm).toHaveBeenCalledWith('Set Confidence?', false);
    expect(prompt.askChoice).toHaveBeenCalledWith('Confidence:', ['low', 'medium', 'high']);
  });

  it('should not call askChoice when user declines', async () => {
    const prompt = makeMockPrompt({
      askConfirm: vi.fn().mockResolvedValue(false)
    });

    const collector = new EnumChoiceTrailerCollector({
      key: 'Confidence',
      confirmMessage: 'Set Confidence?',
      choiceMessage: 'Confidence:',
      values: ['low', 'medium', 'high'],
    });

    await collector.collect(prompt);

    expect(prompt.askChoice).not.toHaveBeenCalled();
  });

  it('should work with Scope-risk config', async () => {
    const prompt = makeMockPrompt({
      askConfirm: vi.fn().mockResolvedValue(true),
      askChoice: vi.fn().mockResolvedValue('narrow')
    });

    const collector = new EnumChoiceTrailerCollector({
      key: 'Scope-risk',
      confirmMessage: 'Set Scope-risk?',
      choiceMessage: 'Scope-risk:',
      values: ['narrow', 'moderate', 'wide'],
    });

    const result = await collector.collect(prompt);

    expect(result).toEqual({ key: 'Scope-risk', value: 'narrow' });
    expect(prompt.askChoice).toHaveBeenCalledWith('Scope-risk:', ['narrow', 'moderate', 'wide']);
  });
});
