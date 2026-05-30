import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { runCli } from '../../../src/engine/index.js';
import { TEST_PROTOCOL_DEFINITION, TEST_ENGINE_CONFIG, TEST_ENGINE_DIR, assertIsolatedEngine } from '../engine-test-utils.js';
import { ENGINE_CONFIG_FILENAME } from '../../../src/engine/util/constants.js';
import { resolve } from 'node:path';

describe('Cache Bypass Integration (--no-cache)', () => {
  const originalArgv = process.argv;
  const pkgPath = resolve(process.cwd(), 'package.json');

  beforeAll(() => {
    assertIsolatedEngine(TEST_ENGINE_DIR);
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('should verify the atomRepository is created when running a command', async () => {
    // We avoid global stubbing of 'process' to prevent stack overflow in Vitest
    process.argv = ['node', 'atom', 'log', '--no-cache'];
    
    const { sharedDeps } = await runCli({
      binaryName: 'atom', version: '0.0.0-test',
      description: 'Agnostic',
      engineDirName: TEST_ENGINE_DIR,
      configFileName: ENGINE_CONFIG_FILENAME,
      defaultConfig: TEST_ENGINE_CONFIG,
      staticProtocols: [TEST_PROTOCOL_DEFINITION],
    });

    expect(sharedDeps.atomRepository).toBeDefined();
  });
});
