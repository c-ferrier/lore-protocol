import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runCli } from '../src/index-impl.js';
import { TEST_ENGINE_CONFIG } from '../src/testing.js';
import { makeMockPrompt } from './engine-test-utils.js';
;
import { mkdirSync, rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
;

import { 
  registerCacheCommand,
  registerCommitCommand,
  registerConfigCommand,
  registerDoctorCommand,
  registerLogCommand,
  registerSquashCommand,
  registerStaleCommand,
  registerTraceCommand,
  registerValidateCommand,
  SYSTEM_PROTOCOL 
} from '../src/index.js';

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
    const { program, infra } = await runCli({
      binaryName: 'atom',
      version: '0.0.0-test',
      description: 'Agnostic',
      engineDirName: '.atom',
      configFileName: 'config.toml',
      defaultConfig: TEST_ENGINE_CONFIG,
      staticProtocols: [], // NO protocols
      prompt: makeMockPrompt(),
    });

    registerLogCommand(program, infra);
    registerStaleCommand(program, infra);
    registerTraceCommand(program, infra, SYSTEM_PROTOCOL);
    registerCommitCommand(program, infra);
    registerValidateCommand(program, infra);
    registerSquashCommand(program, infra);
    registerCacheCommand(program, infra);
    registerConfigCommand(program, infra);
    registerDoctorCommand(program, infra);

    const helpText = program.helpInformation();
    expect(helpText).toContain('Usage: atom');
    expect(helpText).toContain('config');
    expect(helpText).toContain('doctor');
    expect(helpText).toContain('log');
    expect(helpText).not.toContain('init'); // init is a Lore-specific shim for now
  });
});