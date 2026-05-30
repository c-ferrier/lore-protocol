import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildLoreCli } from '../../../src/lore/cli-wrapper.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

describe('Lore CLI Configuration Mapping', () => {
  const testDir = join(tmpdir(), `lore-mapping-test-${Date.now()}`);
  const pkgPath = join(testDir, 'package.json');
  const loreConfigDir = join(testDir, '.lore');
  const loreConfigPath = join(loreConfigDir, 'config.toml');

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    mkdirSync(loreConfigDir, { recursive: true });
    writeFileSync(pkgPath, JSON.stringify({ version: '0.5.0' }));
    
    vi.stubGlobal('process', {
      ...process,
      argv: ['node', 'lore'],
      cwd: () => testDir,
    });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
      if (require('node:fs').existsSync(loreConfigPath)) {
          rmSync(loreConfigPath);
      }
  });

  it('should translate intent_max_length to subjectMaxLength', async () => {
    writeFileSync(loreConfigPath, `
[validation]
intent_max_length = 42
`);

    const { sharedDeps } = await buildLoreCli();
    const config = sharedDeps.config;
    expect(config.validation.subjectMaxLength).toBe(42);
  });

  it('should enable permissive mode if only standard trailers are used', async () => {
    writeFileSync(loreConfigPath, `
[trailers]
required = ["Confidence"]
custom = ["Tested"]
`);

    const { sharedDeps } = await buildLoreCli();
    const lore = sharedDeps.protocolRegistry.get('Lore')!;
    expect(lore.permissive).toBe(true);
    expect(lore.getAuthorizedKeys()).toContain('Confidence');
    expect(lore.getDefinition('Confidence')?.required).toBe(true);
  });

  it('should disable permissive mode (auto-lockdown) if custom trailers are added', async () => {
    writeFileSync(loreConfigPath, `
[trailers]
custom = ["New-Trailer"]
`);

    const { sharedDeps } = await buildLoreCli();
    const lore = sharedDeps.protocolRegistry.get('Lore')!;
    
    // Auto-lockdown: non-standard trailer found
    expect(lore.permissive).toBe(false);
    expect(lore.owns('New-Trailer')).toBe(true);
  });

  it('should correctly map follow.max_depth', async () => {
    writeFileSync(loreConfigPath, `
[follow]
max_depth = 9
`);

    const { sharedDeps } = await buildLoreCli();
    expect(sharedDeps.config.follow.maxDepth).toBe(9);
  });
});
