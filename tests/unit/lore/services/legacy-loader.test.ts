import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoreLegacyLoader } from '../../../../src/lore/services/legacy-loader.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('LoreLegacyLoader (0.5.0 Compatibility)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lore-legacy-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should translate intent_max_length to subjectMaxLength engine override', async () => {
    const configPath = join(tempDir, 'config.toml');
    await writeFile(configPath, `
[validation]
intent_max_length = 42
`);

    const loader = new LoreLegacyLoader(configPath);
    const result = await loader.load();

    expect(result?.engineOverrides.validation?.subjectMaxLength).toBe(42);
  });

  it('should toggle permissive=false if custom trailers are defined without explicit permissive flag', async () => {
    const configPath = join(tempDir, 'config.toml');
    await writeFile(configPath, `
[trailers.definitions.Team]
description = "team"
`);

    const loader = new LoreLegacyLoader(configPath);
    const result = await loader.load();

    expect(result?.protocolConfig.trailers?.permissive).toBe(false);
    expect(result?.protocolConfig.trailers?.definitions.Team).toBeDefined();
  });

  it('should honor explicit permissive=true even with custom trailers', async () => {
    const configPath = join(tempDir, 'config.toml');
    await writeFile(configPath, `
[trailers]
permissive = true
[trailers.definitions.Team]
description = "team"
`);

    const loader = new LoreLegacyLoader(configPath);
    const result = await loader.load();

    expect(result?.protocolConfig.trailers?.permissive).toBe(true);
  });

  it('should return null if file does not exist', async () => {
      const loader = new LoreLegacyLoader(join(tempDir, 'non-existent.toml'));
      const result = await loader.load();
      expect(result).toBeNull();
  });
});
