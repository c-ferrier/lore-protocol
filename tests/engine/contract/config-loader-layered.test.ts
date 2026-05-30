import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EngineConfigLoader } from '../../../src/engine/services/config-loader.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Layered Configuration Integration', () => {
  let tempDir: string;
  const ENGINE_DIR = '.atom-test';
  
  const DEFAULT_CONFIG = {
    protocol: { name: 'Atom', version: '1.0' },
    permissive: true, trailers: { definitions: {} },
    cli: { updateCheck: true, queryCache: true }
  } as any;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'layered-config-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should merge engine configurations correctly', async () => {
    // 1. Setup Engine Global (Simulation: project root .atom-test)
    const configDir = join(tempDir, ENGINE_DIR);
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'config.toml'), `
[cli]
update_check = false
query_cache = true
    `);

    // 2. Test Loading
    const engineLoader = new EngineConfigLoader(ENGINE_DIR, 'config.toml', DEFAULT_CONFIG);
    const engineConfig = await engineLoader.loadForPath(tempDir);

    expect(engineConfig.cli.updateCheck).toBe(false);
    expect(engineConfig.cli.queryCache).toBe(true);
  });
});
