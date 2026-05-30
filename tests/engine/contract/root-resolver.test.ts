import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveProtocolRoot } from '../../../src/engine/services/root-resolver.js';
import type { ConfigLoader } from '../../../src/engine/services/config-loader.js';
import type { IGitClient } from '../../../src/engine/interfaces/git-client.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeMockGitClient, makeMockConfigLoader } from '../engine-test-utils.js';

describe('resolveProtocolRoot', () => {
  let tempDir: string;
  let mockConfigLoader: any;
  let mockGitClient: any;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'root-resolver-test-'));
    mockConfigLoader = makeMockConfigLoader();
    mockGitClient = makeMockGitClient();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should resolve to config path directory if config exists', async () => {
    const projectDir = join(tempDir, 'project');
    const configPath = join(projectDir, '.atom', 'config.toml');
    mockConfigLoader.findConfigPath.mockResolvedValue(configPath);

    const result = await resolveProtocolRoot(projectDir, mockConfigLoader, mockGitClient);

    expect(result.protocolRoot).toBe(projectDir);
  });

  it('should resolve to git root if no config found', async () => {
    const projectDir = join(tempDir, 'project');
    mockConfigLoader.findConfigPath.mockResolvedValue(null);
    mockGitClient.getRepoRoot.mockResolvedValue(projectDir);

    const result = await resolveProtocolRoot(projectDir, mockConfigLoader, mockGitClient);

    expect(result.protocolRoot).toBe(projectDir);
  });

  it('should fallback to input dir if neither config nor git root found', async () => {
    mockConfigLoader.findConfigPath.mockResolvedValue(null);
    mockGitClient.getRepoRoot.mockRejectedValue(new Error('not a git repo'));

    const result = await resolveProtocolRoot(tempDir, mockConfigLoader, mockGitClient);

    expect(result.protocolRoot).toBe(tempDir);
  });
});
