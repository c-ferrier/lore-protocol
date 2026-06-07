import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProtocolContext } from '../../../../src/engine/core/types/protocol-definition.js';
import { type IGitClient } from '../../../../src/engine/interfaces/git-client.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { readHeadIdentities } from '../../../../src/engine/shell/git/head-id-reader.js';
import { makeStubProtocolContext } from '../../../../src/engine/testing.js';

const TEST_ID_KEY = "Mock-id";

function createMockGitClient(headMessage: string): IGitClient {
  return {
    log: vi.fn(async (args) => {
       if (args.includes('-1')) {
         return [{ hash: 'h1', trailers: headMessage.split('\n\n').pop() || headMessage } as any];
       }
       return [];
    }),
    blame: vi.fn(),
    commit: vi.fn(),
    hasStagedChanges: vi.fn(),
    getRepoRoot: vi.fn(),
    isInsideRepo: vi.fn(),
    getFilesChanged: vi.fn().mockResolvedValue(new Map()),
    getCommitsByHashes: vi.fn(),
    countCommitsSince: vi.fn(),
    resolveRef: vi.fn(),
    resolveDate: vi.fn(),
    getHeadMessage: vi.fn().mockResolvedValue(headMessage),
  } as any;
}

describe('readHeadIdentities', () => {
  let protocolRegistry: ProtocolRegistry;
  let protocol: ProtocolContext;

  beforeEach(() => {
    protocolRegistry = new ProtocolRegistry();
    protocol = makeStubProtocolContext();
    protocolRegistry.register(protocol);
  });

  it(`should return ${TEST_ID_KEY} when HEAD has Mock trailers`, async () => {
    const message = [
      'feat: add login flow',
      '',
      `${TEST_ID_KEY}: a1b2c3d4`,
      'Confidence: high',
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const result = await readHeadIdentities(gitClient, protocolRegistry);

    expect(result.mock).toBe('a1b2c3d4');
  });

  it('should return empty object when HEAD has no trailers', async () => {
    const message = 'feat: simple commit with no trailers';

    const gitClient = createMockGitClient(message);
    const result = await readHeadIdentities(gitClient, protocolRegistry);

    expect(result).toEqual({});
  });

  it(`should return empty object when HEAD has trailers but no ${TEST_ID_KEY}`, async () => {
    const message = [
      'feat: add login flow',
      '',
      'Confidence: high',
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const result = await readHeadIdentities(gitClient, protocolRegistry);

    expect(result.mock).toBeUndefined();
  });

  it('should handle empty commit message', async () => {
    const gitClient = createMockGitClient('');
    const result = await readHeadIdentities(gitClient, protocolRegistry);

    expect(result).toEqual({});
  });

  it(`should return ${TEST_ID_KEY} from a full commit message with body`, async () => {
    const message = [
      'feat: add login flow',
      '',
      'This is a body explaining why we added the login flow.',
      '',
      `${TEST_ID_KEY}: deadbeef`,
      'Confidence: high',
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const result = await readHeadIdentities(gitClient, protocolRegistry);

    expect(result.mock).toBe('deadbeef');
  });

  it(`should return empty object when ${TEST_ID_KEY} is not valid hex format`, async () => {
    const message = [
      'feat: add login flow',
      '',
      `${TEST_ID_KEY}: not-valid`,
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const result = await readHeadIdentities(gitClient, protocolRegistry);

    expect(result.mock).toBeUndefined();
  });
});
