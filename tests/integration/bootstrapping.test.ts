import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EngineBootstrapper } from '../../src/engine/services/engine-bootstrapper.js';
import { DEFAULT_ENGINE_CONFIG } from '../../src/engine/defaults.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

describe('Engine Bootstrapping Integration', () => {
  let testDir: string;
  const engineDir = '.test-engine';
  const configFile = 'config.toml';

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'engine-bootstrap-int-'));
    // Initialize a dummy git repo so root resolver is happy
    execSync('git init', { cwd: testDir, stdio: 'ignore' });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const setupEngineDir = async () => {
      await mkdir(join(testDir, engineDir), { recursive: true });
      await mkdir(join(testDir, engineDir, 'protocols'), { recursive: true });
  };

  it('should load a protocol blueprint from the file system', async () => {
    await setupEngineDir();
    const blueprint = `
name = "Custom"
version = "2.0"
identity_key = "CID"

[trailers.CID]
description = "Custom ID"
validation = "pattern"
pattern = "^[0-9]+$"
`;
    await writeFile(join(testDir, engineDir, 'protocols', 'custom.toml'), blueprint);

    const bootstrapper = new EngineBootstrapper({
        binaryName: 'test',
        version: '1.0',
        description: '',
        engineDirName: engineDir,
        configFileName: configFile,
        defaultConfig: DEFAULT_ENGINE_CONFIG,
        staticProtocols: []
    });

    const { sharedDeps } = await bootstrapper.bootstrap(testDir, []);
    const custom = sharedDeps.protocolRegistry.get('Custom');

    expect(custom).toBeDefined();
    expect(custom?.version).toBe('2.0');
    expect(custom?.identityKey).toBe('CID');
    expect(custom?.getAuthorizedKeys()).toContain('CID');
  });

  it('should apply config.toml overrides to a dynamic protocol', async () => {
    await setupEngineDir();
    // 1. Create Blueprint
    const blueprint = 'name = "Overridden"\ntrailers = { ID = { description = "old" } }';
    await writeFile(join(testDir, engineDir, 'protocols', 'overridden.toml'), blueprint);

    // 2. Create Config with Overrides
    const config = `
[protocols.Overridden]
permissive = false
strict = true

[protocols.Overridden.trailers.ID]
description = "new"
`;
    await writeFile(join(testDir, engineDir, configFile), config);

    const bootstrapper = new EngineBootstrapper({
        binaryName: 'test',
        version: '1.0',
        description: '',
        engineDirName: engineDir,
        configFileName: configFile,
        defaultConfig: DEFAULT_ENGINE_CONFIG,
        staticProtocols: []
    });

    const { sharedDeps } = await bootstrapper.bootstrap(testDir, []);
    const protocol = sharedDeps.protocolRegistry.get('Overridden')!;

    expect(protocol.permissive).toBe(false);
    expect(protocol.getDefinition('ID')?.description).toBe('new');
  });

  it('should throw a descriptive error if a dynamic protocol is malformed', async () => {
      await setupEngineDir();
      await writeFile(join(testDir, engineDir, 'protocols', 'broken.toml'), 'invalid = [ toml');

      const bootstrapper = new EngineBootstrapper({
          binaryName: 'test',
          version: '1.0',
          description: '',
          engineDirName: engineDir,
          configFileName: configFile,
          defaultConfig: DEFAULT_ENGINE_CONFIG,
          staticProtocols: []
      });

      // Expect it to throw (smol-toml error)
      await expect(bootstrapper.bootstrap(testDir, [])).rejects.toThrow();
  });

  it('should detect and prevent conflicts between static and dynamic protocols during bootstrap', async () => {
      await setupEngineDir();
      
      await writeFile(join(testDir, engineDir, 'protocols', 'p1.toml'), 'name = "Conflict"');
      await writeFile(join(testDir, engineDir, 'protocols', 'p2.toml'), 'name = "Conflict"');

      const bootstrapper = new EngineBootstrapper({
          binaryName: 'test',
          version: '1.0',
          description: '',
          engineDirName: engineDir,
          configFileName: configFile,
          defaultConfig: DEFAULT_ENGINE_CONFIG,
          staticProtocols: []
      });

      await expect(bootstrapper.bootstrap(testDir, [])).rejects.toThrow(/Duplicate protocol definition/);
  });
});
