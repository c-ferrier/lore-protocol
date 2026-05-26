import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCli } from '../../../src/engine/index.js';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { MOCK_CONFIG } from './test-utils.js';

describe('Agnostic Behavior (Zero Protocols)', () => {
  const testDir = join(tmpdir(), `agnostic-test-${Date.now()}`);
  const pkgPath = join(testDir, 'package.json');

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(pkgPath, JSON.stringify({ version: '1.0.0' }));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should allow running agnostic commands without any registered protocols', async () => {
    // Standard administrative commands should work in "Atom" mode
    const { program } = await runCli({
      binaryName: 'atom',
      description: 'Agnostic',
      engineDirName: '.atom',
      configFileName: 'config.toml',
      defaultConfig: MOCK_CONFIG,
      staticProtocols: [], // NO protocols
      packageJsonPath: pkgPath
    });

    const helpText = program.helpInformation();
    expect(helpText).toContain('Usage: atom');
    expect(helpText).toContain('config');
    expect(helpText).toContain('doctor');
    expect(helpText).toContain('log');
    expect(helpText).not.toContain('init'); // init is a Lore-specific shim for now
  });
});
