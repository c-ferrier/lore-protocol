import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommitInputResolver } from '../../../../src/engine/services/commit-input-resolver.js';
import type { IPrompt } from '../../../../src/engine/interfaces/prompt.js';
import { LORE_DEFAULT_CONFIG } from '../../../../src/lore/defaults.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { LoreProtocolDefinition } from '../../../../src/lore/protocol-definition.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';

function createMockPrompt(overrides: Partial<IPrompt> = {}): IPrompt {
  return {
    askText: vi.fn(),
    askConfirm: vi.fn(),
    askChoice: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

describe('CommitInputResolver', () => {
  let resolver: CommitInputResolver;
  let prompt: IPrompt;
  let protocol: Protocol;
  let registry: ProtocolRegistry;

  beforeEach(() => {
    prompt = createMockPrompt();
    protocol = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);
    registry = new ProtocolRegistry();
    registry.register(protocol);
    resolver = new CommitInputResolver(prompt, registry);
  });

  describe('mode resolution priority', () => {
    it('should dispatch to flags reader when --intent is set', async () => {
      const options = { intent: 'feat: add login' };
      const result = await resolver.resolve(options);
      expect(result.intent).toBe('feat: add login');
    });

    it('should prefer interactive over file when both are set', async () => {
      const options = { interactive: true, file: 'config.json' };
      // This will hang on interactive if not mocked, but we just check mode if we could
      // Since resolve() actually runs it, we need to mock the reader or just verify behavior.
      vi.mocked(prompt.askText).mockResolvedValue('inter-intent');
      const result = await resolver.resolve(options);
      expect(result.intent).toBe('inter-intent');
    });

    it('should prefer flags over stdin when intent is set and not a TTY', async () => {
      vi.stubGlobal('process', {
        ...process,
        stdin: { isTTY: false },
      });

      const options = { intent: 'feat: from flags' };
      const result = await resolver.resolve(options);

      expect(result.intent).toBe('feat: from flags');
      vi.unstubAllGlobals();
    });
  });
});
