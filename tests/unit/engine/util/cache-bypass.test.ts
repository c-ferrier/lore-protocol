import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCli } from '../../../../src/engine/index.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG } from '../test-utils.js';
import { resolve } from 'node:path';

describe('Cache Bypass Integration (--no-cache)', () => {
  const originalArgv = process.argv;
  const pkgPath = resolve(process.cwd(), 'package.json');

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('should verify the atomRepository is created when running a command', async () => {
    // We avoid global stubbing of 'process' to prevent stack overflow in Vitest
    process.argv = ['node', 'atom', 'log', '--no-cache'];
    
    const { sharedDeps } = await runCli({
      binaryName: 'atom',
      description: 'Agnostic',
      engineDirName: '.atom',
      configFileName: 'config.toml',
      defaultConfig: MOCK_CONFIG,
      staticProtocols: [MOCK_PROTOCOL_DEFINITION],
      packageJsonPath: pkgPath
    });

    expect(sharedDeps.atomRepository).toBeDefined();
  });
});
