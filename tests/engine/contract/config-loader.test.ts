import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EngineConfigLoader } from '../../../src/engine/services/config-loader.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const MOCK_ENGINE_CONFIG = {
  validation: { strict: false, maxMessageLines: 50, subjectMaxLength: 72 },
  stale: { olderThan: '6m', driftThreshold: 20 },
  output: { defaultFormat: 'text' as const },
  follow: { maxDepth: 3 },
  cli: { updateCheck: false, cache: true, queryCache: true, queryCachePruneThreshold: 100 },
};

describe('EngineConfigLoader', () => {
  let loader: EngineConfigLoader;
  let tempDir: string;

  beforeEach(async () => {
    loader = new EngineConfigLoader('.atom', 'config.toml', MOCK_ENGINE_CONFIG);
    tempDir = await mkdtemp(join(tmpdir(), 'engine-config-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createConfigFile(dir: string, content: string): Promise<string> {
    const atomDir = join(dir, '.atom');
    await mkdir(atomDir, { recursive: true });
    const configPath = join(atomDir, 'config.toml');
    await writeFile(configPath, content, 'utf-8');
    return configPath;
  }

  it('should load pure engine settings and ignore unknown sections', async () => {
    const configPath = await createConfigFile(tempDir, `
[validation]
strict = true
subject_max_length = 80

[cli]
update_check = true

[some_plugin_section]
foo = "bar"
`);

    const config = await loader.loadFromFile(configPath);

    expect(config.validation.strict).toBe(true);
    expect(config.validation.subjectMaxLength).toBe(80);
    expect(config.cli.updateCheck).toBe(true);
    // Section "some_plugin_section" should be ignored by the engine loader
    expect((config as any).some_plugin_section).toBeUndefined();
  });

  it('should walk up the tree to find .atom/config.toml', async () => {
    await createConfigFile(tempDir, `[validation]\nstrict = true`);
    const subDir = join(tempDir, 'a/b/c');
    await mkdir(subDir, { recursive: true });

    const config = await loader.loadForPath(subDir);
    expect(config.validation.strict).toBe(true);
  });

  it('should stop walking at Git boundary', async () => {
    await createConfigFile(tempDir, `[validation]\nstrict = true`);
    const subDir = join(tempDir, 'repo');
    await mkdir(join(subDir, '.git'), { recursive: true });

    const config = await loader.loadForPath(subDir);
    expect(config.validation.strict).toBe(false); // Should use defaults
  });
});
