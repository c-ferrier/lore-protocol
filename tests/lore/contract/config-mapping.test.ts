import { existsSync,mkdirSync, rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach,describe, expect, it, vi } from 'vitest';

import { buildLoreCli } from '../lore-test-utils.js';

describe('Lore CLI Configuration Mapping', () => {
  let testDir: string;
  let pkgPath: string;
  let loreConfigDir: string;
  let loreConfigPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `lore-mapping-test-${Date.now()}-${Math.random()}`);
    pkgPath = join(testDir, 'package.json');
    loreConfigDir = join(testDir, '.lore');
    loreConfigPath = join(loreConfigDir, 'config.toml');

    mkdirSync(testDir, { recursive: true });
    mkdirSync(loreConfigDir, { recursive: true });
    writeFileSync(pkgPath, JSON.stringify({ version: '0.5.0' }));
    
    vi.stubGlobal('process', {
      ...process,
      argv: ['node', 'lore'],
      cwd: () => testDir,
    });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
      if (existsSync(loreConfigPath)) {
          rmSync(loreConfigPath);
      }
  });

  it('should translate intent_max_length to subjectMaxLength', async () => {
    writeFileSync(loreConfigPath, `
[validation]
intent_max_length = 42
`);

    const { infra } = await buildLoreCli({ 
        engineDirName: '.atom', 
        configFileName: 'config.toml' 
    });
    const config = infra.config;
    expect(config.validation.subjectMaxLength).toBe(42);
  });

  it('should enable permissive mode if only standard trailers are used', async () => {
    writeFileSync(loreConfigPath, `
[protocol]
version = "1.0"
`);

    const { infra } = await buildLoreCli({ 
        engineDirName: '.atom', 
        configFileName: 'config.toml' 
    });
    const lore = infra.protocols.get('lore')!;
    expect(lore).toBeDefined();
    expect(lore.permissive).toBe(true);
  });

  it('should disable permissive mode (auto-lockdown) if custom trailers are added', async () => {
    writeFileSync(loreConfigPath, `
[protocol]
version = "1.0"
[trailers]
custom = ["New-Trailer"]
`);

    const { infra } = await buildLoreCli({ 
        engineDirName: '.atom', 
        configFileName: 'config.toml' 
    });
    const lore = infra.protocols.get('lore')!;
    
    // Auto-lockdown: non-standard trailer found
    expect(lore.permissive).toBe(false);
  });

  it('should correctly map follow.max_depth', async () => {
    writeFileSync(loreConfigPath, `
[follow]
max_depth = 9
`);

    const { infra } = await buildLoreCli({ 
        engineDirName: '.atom', 
        configFileName: 'config.toml' 
    });
    expect(infra.config.follow.maxDepth).toBe(9);
  });

  it('should correctly map legacy validation.strict to lore protocol strictness', async () => {
    writeFileSync(loreConfigPath, `
[validation]
strict = true
`);

    const { infra } = await buildLoreCli({ 
        engineDirName: '.atom', 
        configFileName: 'config.toml' 
    });
    
    const lore = infra.protocols.get('lore')!;
    expect(lore.strict).toBe(true);
  });
});