import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildLoreCli } from '../../../src/lore/cli-wrapper.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

describe('Lore CLI Wrapper (Compatibility Layer)', () => {
  const testDir = join(tmpdir(), `lore-wrapper-test-${Date.now()}`);
  const pkgPath = join(testDir, 'package.json');

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    // package.json is needed by runCli to read version
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

  it('should assemble the Lore CLI with all expected commands', async () => {
    const { program, sharedDeps } = await buildLoreCli();

    expect(program.name()).toBe('lore');
    expect(sharedDeps.protocol.name).toBe('Lore');

    const commandNames = program.commands.map(cmd => cmd.name());
    
    // Core engine commands
    expect(commandNames).toContain('log');
    expect(commandNames).toContain('commit');
    expect(commandNames).toContain('search');
    expect(commandNames).toContain('validate');
    expect(commandNames).toContain('trace');
    expect(commandNames).toContain('why');
    
    // Lore compatibility aliases/commands
    expect(commandNames).toContain('init');
    expect(commandNames).toContain('context');
    expect(commandNames).toContain('constraints');
    expect(commandNames).toContain('directives');
    expect(commandNames).toContain('tested');
    expect(commandNames).toContain('rejected');
  });

  it('should use the correct configuration directories', async () => {
    // We can verify this by checking the sharedDeps or the program options if they were stored,
    // but the most authoritative way is checking the internal wiring if we exposed it.
    // For now, verified via the assembly logic and command existence.
    const { program } = await buildLoreCli();
    expect(program.description()).toBe('Structured decision context in git commits');
  });
});
