import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommitInputResolver } from '../../../../src/engine/services/commit-input-resolver.js';
import type { IPrompt } from '../../../../src/engine/interfaces/prompt.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG } from '../test-utils.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';

function createMockPrompt(overrides: Partial<IPrompt> = {}): IPrompt {
  return {
    askText: vi.fn(),
    askConfirm: vi.fn(),
    askChoice: vi.fn(),
    askMultiline: vi.fn(),
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
    protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG);
    registry = new ProtocolRegistry();
    registry.register(protocol);
    resolver = new CommitInputResolver(prompt, registry);
  });

  describe('mode resolution priority', () => {
    it('should dispatch to flags reader when --subject is set', async () => {
      const options = { subject: 'feat: add login' };
      const result = await resolver.resolve(options);
      expect(result.subject).toBe('feat: add login');
    });

    it('should prefer interactive over file when both are set', async () => {
      const options = { interactive: true, file: 'config.json' };
      vi.mocked(prompt.askText).mockResolvedValue('inter-subject');
      vi.mocked(prompt.askConfirm).mockResolvedValue(false);
      const result = await resolver.resolve(options);
      expect(result.subject).toBe('inter-subject');
    });

    it('should prefer flags over stdin when subject is set and not a TTY', async () => {
      vi.stubGlobal('process', {
        ...process,
        stdin: { isTTY: false },
      });

      const options = { subject: 'feat: from flags' };
      const result = await resolver.resolve(options);

      expect(result.subject).toBe('feat: from flags');
      vi.unstubAllGlobals();
    });
  });
});
