import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveProtocolRoot } from '../../../../src/engine/services/root-resolver.js';
import type { ConfigLoader } from '../../../../src/engine/services/config-loader.js';
import type { IGitClient } from '../../../../src/engine/interfaces/git-client.js';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

describe('resolveProtocolRoot', () => {
  let tempDir: string;
  let mockConfigLoader: Partial<ConfigLoader>;
  let mockGitClient: Partial<IGitClient>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'root-resolver-test-'));
    mockConfigLoader = {
      findConfigPath: vi.fn(),
    };
    mockGitClient = {
      getRepoRoot: vi.fn(),
    };
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should resolve to config path directory if config exists', async () => {
    const projectDir = join(tempDir, 'project');
    const configPath = join(projectDir, '.atom', 'config.toml');
    vi.mocked(mockConfigLoader.findConfigPath!).mockResolvedValue(configPath);

    const result = await resolveProtocolRoot(projectDir, mockConfigLoader as any, mockGitClient as any);

    expect(result.protocolRoot).toBe(projectDir);
  });

  it('should resolve to git root if no config found', async () => {
    const projectDir = join(tempDir, 'project');
    vi.mocked(mockConfigLoader.findConfigPath!).mockResolvedValue(null);
    vi.mocked(mockGitClient.getRepoRoot!).mockResolvedValue(projectDir);

    const result = await resolveProtocolRoot(projectDir, mockConfigLoader as any, mockGitClient as any);

    expect(result.protocolRoot).toBe(projectDir);
  });

  it('should fallback to input dir if neither config nor git root found', async () => {
    vi.mocked(mockConfigLoader.findConfigPath!).mockResolvedValue(null);
    vi.mocked(mockGitClient.getRepoRoot!).mockRejectedValue(new Error('not a git repo'));

    const result = await resolveProtocolRoot(tempDir, mockConfigLoader as any, mockGitClient as any);

    expect(result.protocolRoot).toBe(tempDir);
  });
});
