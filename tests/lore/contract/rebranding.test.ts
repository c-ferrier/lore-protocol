import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildLoreCli } from '../../../src/lore/cli-wrapper.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

describe('Lore CLI Rebranding (Wrapper Logic)', () => {
  const testDir = join(tmpdir(), `lore-rebrand-test-${Date.now()}`);
  const pkgPath = join(testDir, 'package.json');

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
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

  it('should hide --subject and show --intent in help output', async () => {
    const { program } = await buildLoreCli();
    const commitCmd = program.commands.find(c => c.name() === 'commit')!;

    const subjectOpt = commitCmd.options.find(o => o.long === '--subject');
    const intentOpt = commitCmd.options.find(o => o.long === '--intent');

    expect(subjectOpt).toBeDefined();
    expect((subjectOpt as any).hidden).toBe(true);
    expect(intentOpt).toBeDefined();
    expect((intentOpt as any).hidden).toBeFalsy();

    const helpText = commitCmd.helpInformation();
    expect(helpText).toContain('--intent');
    expect(helpText).not.toContain('--subject');
  });

  it('should map --intent value to subject internally via preAction hook', async () => {
    const { program } = await buildLoreCli();
    const commitCmd = program.commands.find(c => c.name() === 'commit')!;

    // Stub the action to prevent it from actually running (and calling process.exit)
    commitCmd.action(vi.fn());

    // 1. Trigger the preAction hooks by parsing user-style arguments
    await program.parseAsync(['commit', '--intent', 'my decision'], { from: 'user' });
    
    // 2. Verify that the 'subject' option now has the value of 'intent'
    const opts = commitCmd.opts();
    expect(opts.subject).toBe('my decision');
  });

  it('should prioritize --subject if both are somehow provided (edge case)', async () => {
    const { program } = await buildLoreCli();
    const commitCmd = program.commands.find(c => c.name() === 'commit')!;
    
    commitCmd.action(vi.fn());

    await program.parseAsync(['commit', '--subject', 'direct', '--intent', 'alias'], { from: 'user' });
    
    const opts = commitCmd.opts();
    expect(opts.subject).toBe('alias');
  });
});
