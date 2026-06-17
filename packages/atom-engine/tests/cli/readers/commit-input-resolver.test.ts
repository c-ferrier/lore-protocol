import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCommitInput } from '../../../src/cli/readers/commit-input-resolver.js';
import { ProtocolMap } from '../../../src/core/models/protocol-map.js';
import type { ProtocolContext } from '../../../src/core/types/protocol-definition.js';
import { makeStubProtocolContext, TEST_ENGINE_CONFIG, TEST_PROTOCOL_DEFINITION } from '../../../src/testing.js';
import { makeMockPrompt } from '../../engine-test-utils.js';
import { type MockedPrompt } from '../../mock-types.js';

describe('resolveCommitInput', () => {
  let prompt: MockedPrompt;
  let protocol: ProtocolContext;
  let protocols: ProtocolMap<ProtocolContext>;

  beforeEach(() => {
    prompt = makeMockPrompt();
    protocol = makeStubProtocolContext(TEST_PROTOCOL_DEFINITION);
    protocols = new ProtocolMap();
    protocols.set(protocol.name, protocol);
  });

  describe('mode resolution priority', () => {
    it('should dispatch to flags reader when --subject is set', async () => {
      const options = { subject: 'feat: add login' };
      const result = await resolveCommitInput(options, { prompt, protocols, config: TEST_ENGINE_CONFIG });
      expect(result.subject).toBe('feat: add login');
    });

    it('should prefer interactive over file when both are set', async () => {
      const options = { interactive: true, file: 'config.json' };
      prompt.askText.mockResolvedValue('inter-subject');
      prompt.askConfirm.mockResolvedValue(false);
      const result = await resolveCommitInput(options, { prompt, protocols, config: TEST_ENGINE_CONFIG });
      expect(result.subject).toBe('inter-subject');
    });

    it('should prefer flags over stdin when subject is set and not a TTY', async () => {
      vi.stubGlobal('process', {
        ...process,
        stdin: { isTTY: false },
      });

      const options = { subject: 'feat: from flags' };
      const result = await resolveCommitInput(options, { prompt, protocols, config: TEST_ENGINE_CONFIG });

      expect(result.subject).toBe('feat: from flags');
      vi.unstubAllGlobals();
    });
  });
});
