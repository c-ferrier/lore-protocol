import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeadIdReader } from '../../../../src/engine/services/head-id-reader.js';

import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import type { IGitClient } from '../../../../src/engine/interfaces/git-client.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { MOCK_PROTOCOL_DEFINITION, makeAtomRepository, MOCK_CONFIG, makeProtocol } from '../test-utils.js';

const MOCK_ID_KEY = "Mock-id";

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

describe('HeadIdReader', () => {
  let trailerParser: TrailerParser;
  let protocolRegistry: ProtocolRegistry;
  let protocol: Protocol;

  beforeEach(() => {
    trailerParser = new TrailerParser();
    protocolRegistry = new ProtocolRegistry();
    protocol = makeProtocol();
    protocolRegistry.register(protocol);
  });

  it(`should return ${MOCK_ID_KEY} when HEAD has Mock trailers`, async () => {
    const message = [
      'feat: add login flow',
      '',
      `${MOCK_ID_KEY}: a1b2c3d4`,
      'Confidence: high',
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const reader = new HeadIdReader(gitClient, trailerParser, protocolRegistry);

    const result = await reader.read();

    expect(result).toBe('a1b2c3d4');
  });

  it('should return null when HEAD has no trailers', async () => {
    const message = 'feat: simple commit with no trailers';

    const gitClient = createMockGitClient(message);
    const reader = new HeadIdReader(gitClient, trailerParser, protocolRegistry);

    const result = await reader.read();

    expect(result).toBeNull();
  });

  it(`should return null when HEAD has trailers but no ${MOCK_ID_KEY}`, async () => {
    const message = [
      'feat: add login flow',
      '',
      'Confidence: high',
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const reader = new HeadIdReader(gitClient, trailerParser, protocolRegistry);

    const result = await reader.read();

    expect(result).toBeNull();
  });

  it('should handle empty commit message', async () => {
    const gitClient = createMockGitClient('');
    const reader = new HeadIdReader(gitClient, trailerParser, protocolRegistry);

    const result = await reader.read();

    expect(result).toBeNull();
  });

  it(`should return ${MOCK_ID_KEY} from a full commit message with body`, async () => {
    const message = [
      'feat: add login flow',
      '',
      'This is a body explaining why we added the login flow.',
      '',
      `${MOCK_ID_KEY}: deadbeef`,
      'Confidence: high',
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const reader = new HeadIdReader(gitClient, trailerParser, protocolRegistry);

    const result = await reader.read();

    expect(result).toBe('deadbeef');
  });

  it(`should return null when ${MOCK_ID_KEY} is not valid hex format`, async () => {
    const message = [
      'feat: add login flow',
      '',
      `${MOCK_ID_KEY}: not-valid`,
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const reader = new HeadIdReader(gitClient, trailerParser, protocolRegistry);

    const result = await reader.read();

    expect(result).toBeNull();
  });
});
