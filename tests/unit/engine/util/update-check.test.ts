import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCli } from '../../../../src/engine/index.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG } from '../test-utils.js';
import * as updateCheck from '../../../../src/util/update-check.js';
import { resolve } from 'node:path';

describe('Update Check Integration', () => {
  const originalArgv = process.argv;
  const pkgPath = resolve(process.cwd(), 'package.json');

  beforeEach(() => {
    vi.spyOn(updateCheck, 'shouldCheckForUpdate').mockResolvedValue(false);
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('should call shouldCheckForUpdate during bootstrap if enabled', async () => {
    process.argv = ['node', 'atom', 'log'];
    
    await runCli({
      binaryName: 'atom',
      description: 'Agnostic',
      engineDirName: '.atom',
      configFileName: 'config.toml',
      defaultConfig: {
        ...MOCK_CONFIG,
        cli: { ...MOCK_CONFIG.cli, updateCheck: true }
      },
      protocols: [MOCK_PROTOCOL_DEFINITION],
      packageJsonPath: pkgPath
    });

    expect(updateCheck.shouldCheckForUpdate).toHaveBeenCalled();
  });

  it('should NOT call shouldCheckForUpdate if disabled in config', async () => {
    process.argv = ['node', 'atom', 'log'];
    
    await runCli({
      binaryName: 'atom',
      description: 'Agnostic',
      engineDirName: '.atom',
      configFileName: 'config.toml',
      defaultConfig: {
        ...MOCK_CONFIG,
        cli: { ...MOCK_CONFIG.cli, updateCheck: false }
      },
      protocols: [MOCK_PROTOCOL_DEFINITION],
      packageJsonPath: pkgPath
    });

    expect(updateCheck.shouldCheckForUpdate).not.toHaveBeenCalled();
  });
});
