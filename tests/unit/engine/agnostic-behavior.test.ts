import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCli } from '../../../src/engine/index.js';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { GitClient } from '../../../src/engine/services/git-client.js';

describe('Agnostic CLI Behavior', () => {
  const testDir = join(tmpdir(), `agnostic-cli-${Date.now()}`);
  const pkgPath = join(testDir, 'package.json');

  const ATOM_CONFIG = {
    protocol: { name: 'Atom', version: '1.0' },
    trailers: { required: [], custom: [], definitions: {}, permissive: true },
    validation: { strict: false, maxMessageLines: 50, intentMaxLength: 72 },
    stale: { olderThan: '6m', driftThreshold: 20 },
    output: { defaultFormat: 'text' },
    follow: { maxDepth: 3 },
    cli: { updateCheck: false, cache: true, queryCache: true }
  } as any;

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(pkgPath, JSON.stringify({ version: '1.0.0' }));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should run with zero protocols and show normal git commits', async () => {
    const { program } = await runCli({
      binaryName: 'atom',
      description: 'Agnostic',
      engineDirName: '.atom',
      configFileName: 'config.toml',
      defaultConfig: ATOM_CONFIG,
      protocols: [], 
      packageJsonPath: pkgPath
    });

    expect(program.name()).toBe('atom');
    const helpText = program.helpInformation();
    expect(helpText).toContain('Atom-enriched git log');
  });
});
