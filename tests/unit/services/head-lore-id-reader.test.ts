import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeadLoreIdReader } from '../../../src/services/head-lore-id-reader.js';

import { TrailerParser } from '../../../src/services/trailer-parser.js';
import type { IGitClient } from '../../../src/interfaces/git-client.js';
import { Protocol } from '../../../src/services/protocol.js';
import { DEFAULT_CONFIG } from '../../../src/util/constants.js';

const LORE_ID_KEY = "Lore-id";

function createMockGitClient(headMessage: string): IGitClient {
  return {
    log: vi.fn(async (args) => {
       if (args.includes('-1')) {
         return [{ trailers: headMessage.split('\n\n').pop() || headMessage } as any];
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
  };
}

describe('HeadLoreIdReader', () => {
  let trailerParser: TrailerParser;
  const protocol = new Protocol(DEFAULT_CONFIG);

  beforeEach(() => {
    trailerParser = new TrailerParser();
  });

  it(`should return ${LORE_ID_KEY} when HEAD has Lore trailers`, async () => {
    const message = [
      'feat: add login flow',
      '',
      `${LORE_ID_KEY}: a1b2c3d4`,
      'Confidence: high',
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const reader = new HeadLoreIdReader(gitClient, trailerParser, protocol);

    const result = await reader.read();

    expect(result).toBe('a1b2c3d4');
  });

  it('should return null when HEAD has no `trailers', async () => {
    const message = 'feat: simple commit with no trailers';

    const gitClient = createMockGitClient(message);
    const reader = new HeadLoreIdReader(gitClient, trailerParser, protocol);

    const result = await reader.read();

    expect(result).toBeNull();
  });

  it(`should return null when HEAD has trailers but no ${LORE_ID_KEY}`, async () => {
    const message = [
      'feat: add login flow',
      '',
      'Confidence: high',
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const reader = new HeadLoreIdReader(gitClient, trailerParser, protocol);

    const result = await reader.read();

    expect(result).toBeNull();
  });

  it('should handle empty commit message', async () => {
    const gitClient = createMockGitClient('');
    const reader = new HeadLoreIdReader(gitClient, trailerParser, protocol);

    const result = await reader.read();

    expect(result).toBeNull();
  });

  it(`should return ${LORE_ID_KEY} from a full commit message with body`, async () => {
    const message = [
      'feat: add login flow',
      '',
      'This is a body explaining why we added the login flow.',
      '',
      `${LORE_ID_KEY}: deadbeef`,
      'Confidence: high',
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const reader = new HeadLoreIdReader(gitClient, trailerParser, protocol);

    const result = await reader.read();

    expect(result).toBe('deadbeef');
  });

  it('should return null when getHeadMessage throws (empty repo)', async () => {
    const gitClient = createMockGitClient('');
    vi.mocked(gitClient.log).mockRejectedValue(new Error('Git failed'));
    const reader = new HeadLoreIdReader(gitClient, trailerParser, protocol);

    const result = await reader.read();

    expect(result).toBeNull();
  });

  it(`should return null when ${LORE_ID_KEY} is not valid hex format`, async () => {
    const message = [
      'feat: add login flow',
      '',
      `${LORE_ID_KEY}: not-valid`,
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const reader = new HeadLoreIdReader(gitClient, trailerParser, protocol);

    const result = await reader.read();

    expect(result).toBeNull();
  });
});
