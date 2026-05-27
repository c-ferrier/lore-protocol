import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { runCli } from '../../../../src/engine/index.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG, MOCK_ENGINE_DIR, assertIsolatedEngine } from '../test-utils.js';
import * as updateCheck from '../../../../src/util/update-check.js';
import { ENGINE_CONFIG_FILENAME } from '../../../../src/util/constants.js';
import { resolve } from 'node:path';

describe('Update Check Integration', () => {
  const originalArgv = process.argv;
  const pkgPath = resolve(process.cwd(), 'package.json');

  beforeEach(() => {
    vi.spyOn(updateCheck, 'shouldCheckForUpdate').mockResolvedValue(false);
  });

  beforeAll(() => {
    assertIsolatedEngine(MOCK_ENGINE_DIR);
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
      engineDirName: MOCK_ENGINE_DIR,
      configFileName: ENGINE_CONFIG_FILENAME,
      defaultConfig: {
        ...MOCK_CONFIG,
        cli: { ...MOCK_CONFIG.cli, updateCheck: true }
      },
      staticProtocols: [MOCK_PROTOCOL_DEFINITION],
      packageJsonPath: pkgPath
    });

    expect(updateCheck.shouldCheckForUpdate).toHaveBeenCalled();
  });

  it('should NOT call shouldCheckForUpdate if disabled in config', async () => {
    process.argv = ['node', 'atom', 'log'];
    
    await runCli({
      binaryName: 'atom',
      description: 'Agnostic',
      engineDirName: MOCK_ENGINE_DIR,
      configFileName: ENGINE_CONFIG_FILENAME,
      defaultConfig: {
        ...MOCK_CONFIG,
        cli: { ...MOCK_CONFIG.cli, updateCheck: false }
      },
      staticProtocols: [MOCK_PROTOCOL_DEFINITION],
      packageJsonPath: pkgPath
    });

    expect(updateCheck.shouldCheckForUpdate).not.toHaveBeenCalled();
  });
});
