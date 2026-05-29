import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoreConfigLoader } from '../../../../src/lore/services/lore-config-loader.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('LoreConfigLoader (0.5.0 Compatibility)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lore-legacy-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should parse raw validation intent_max_length', async () => {
    const configPath = join(tempDir, 'config.toml');
    await writeFile(configPath, `
[validation]
intent_max_length = 42
`);

    const loader = new LoreConfigLoader(configPath);
    const result = await loader.load();

    expect(result?.validation?.intent_max_length).toBe(42);
  });

  it('should parse raw custom trailers array', async () => {
    const configPath = join(tempDir, 'config.toml');
    await writeFile(configPath, `
[trailers]
custom = ["Team", "Squad"]
`);

    const loader = new LoreConfigLoader(configPath);
    const result = await loader.load();

    expect(result?.trailers?.custom).toEqual(["Team", "Squad"]);
  });

  it('should parse raw required trailers array', async () => {
    const configPath = join(tempDir, 'config.toml');
    await writeFile(configPath, `
[trailers]
required = ["Confidence", "Tested"]
`);

    const loader = new LoreConfigLoader(configPath);
    const result = await loader.load();

    expect(result?.trailers?.required).toEqual(["Confidence", "Tested"]);
  });

  it('should return null if file does not exist', async () => {
      const loader = new LoreConfigLoader(join(tempDir, 'non-existent.toml'));
      const result = await loader.load();
      expect(result).toBeNull();
  });
});
