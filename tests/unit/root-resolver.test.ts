import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveProtocolRoot } from '../../src/engine/services/root-resolver.js';
import type { IConfigLoader } from '../../src/engine/interfaces/config-loader.js';
import type { IGitClient } from '../../src/engine/interfaces/git-client.js';

describe('resolveProtocolRoot', () => {
  const mockConfigLoader = {
    findConfigPath: vi.fn(),
  } as unknown as IConfigLoader;

  const mockGitClient = {
    isInsideRepo: vi.fn(),
    getRepoRoot: vi.fn(),
  } as unknown as IGitClient;

  const cwd = '/users/dev/project/src';

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the parent of protocol directory and git root if both exist', async () => {
    const configPath = '/users/dev/project/.lore/config.toml';
    vi.mocked(mockConfigLoader.findConfigPath).mockResolvedValue(configPath);
    vi.mocked(mockGitClient.isInsideRepo).mockResolvedValue(true);
    vi.mocked(mockGitClient.getRepoRoot).mockResolvedValue('/users/dev');

    const roots = await resolveProtocolRoot(cwd, mockConfigLoader, mockGitClient);

    expect(roots.protocolRoot).toBe('/users/dev/project');
    expect(roots.gitRoot).toBe('/users/dev');
    expect(mockConfigLoader.findConfigPath).toHaveBeenCalledWith(cwd);
  });

  it('returns git root as protocol root if no config is found', async () => {
    vi.mocked(mockConfigLoader.findConfigPath).mockResolvedValue(null);
    vi.mocked(mockGitClient.isInsideRepo).mockResolvedValue(true);
    vi.mocked(mockGitClient.getRepoRoot).mockResolvedValue('/users/dev/project');

    const roots = await resolveProtocolRoot(cwd, mockConfigLoader, mockGitClient);

    expect(roots.protocolRoot).toBe('/users/dev/project');
    expect(roots.gitRoot).toBe('/users/dev/project');
  });

  it('falls back to cwd if neither config nor git root is found', async () => {
    vi.mocked(mockConfigLoader.findConfigPath).mockResolvedValue(null);
    vi.mocked(mockGitClient.isInsideRepo).mockResolvedValue(false);

    const roots = await resolveProtocolRoot(cwd, mockConfigLoader, mockGitClient);

    expect(roots.protocolRoot).toBe(cwd);
    expect(roots.gitRoot).toBeNull();
  });

  it('falls back to cwd if an error occurs during resolution', async () => {
    vi.mocked(mockConfigLoader.findConfigPath).mockRejectedValue(new Error('FS Error'));

    const roots = await resolveProtocolRoot(cwd, mockConfigLoader, mockGitClient);

    expect(roots.protocolRoot).toBe(cwd);
  });

  it('prioritizes protocol directory for protocolRoot over git root', async () => {
    // Scenario: A project inside a larger git repo, but with its own config
    const configPath = '/users/dev/project/sub-project/.atom/config.toml';
    vi.mocked(mockConfigLoader.findConfigPath).mockResolvedValue(configPath);
    vi.mocked(mockGitClient.isInsideRepo).mockResolvedValue(true);
    vi.mocked(mockGitClient.getRepoRoot).mockResolvedValue('/users/dev/project');

    const roots = await resolveProtocolRoot(cwd, mockConfigLoader, mockGitClient);

    expect(roots.protocolRoot).toBe('/users/dev/project/sub-project');
    expect(roots.gitRoot).toBe('/users/dev/project');
  });
});
