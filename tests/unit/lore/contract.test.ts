import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildLoreCli } from '../../../src/lore/cli-wrapper.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

/**
 * LORE CLI CONTRACT TEST
 * 
 * This test suite defines the "Contract" between our new decoupled architecture
 * and the original Lore 0.5.0 CLI. 
 * 
 * MANDATE: Every command and option present in Lore 0.5.0 must exist in our 
 * wrapper to ensure backward compatibility.
 */
describe('Lore CLI 0.5.0 Compatibility Contract', () => {
  const testDir = join(tmpdir(), `lore-contract-test-${Date.now()}`);
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

  it('CONTRACT: must support all 0.5.0 top-level commands and descriptions', async () => {
    const { program } = await buildLoreCli();
    expect(program.description()).toBe('Structured decision context in git commits');
    
    const commandNames = program.commands.map(cmd => cmd.name());

    const expectedCommands: Record<string, string> = {
      'init': 'Initialize .lore/ config in repository',
      'context': 'Full lore summary for a code region',
      'constraints': 'Active constraints for a code region',
      'rejected': 'Previously rejected alternatives for a code region',
      'directives': 'Active forward-looking warnings for a code region',
      'tested': 'Test coverage: what was and was not verified',
      'coverage': 'Test coverage map (alias for tested)',
      'why': 'Decision context for a specific line or line range (Lore)',
      'search': 'Search across all lore atoms with filters',
      'log': 'Lore-enriched git log',
      'stale': 'Flag potentially outdated knowledge',
      'trace': 'Trace the lineage and relationships of a decision',
      'commit': 'Create a Lore-enriched commit',
      'validate': 'Validate commits for Lore protocol compliance',
      'squash': 'Merge atoms for squash-merge preparation',
      'doctor': 'Check the health of the decision repository'
    };

    for (const [name, desc] of Object.entries(expectedCommands)) {
      const cmd = program.commands.find(c => c.name() === name);
      expect(cmd, `Command ${name} missing`).toBeDefined();
      expect(cmd?.description(), `Description mismatch for ${name}`).toBe(desc);
    }
  });

  it('CONTRACT: commit command must support all 0.5.0 options', async () => {
    const { program } = await buildLoreCli();
    const commitCmd = program.commands.find(c => c.name() === 'commit')!;
    
    // Original 0.5.0 options
    const contractOptions = [
      'amend', 'no-edit', 'file', 'interactive', 'intent', 'body',
      'constraint', 'rejected', 'confidence', 'scope-risk', 'reversibility',
      'directive', 'tested', 'not-tested', 'supersedes', 'depends-on', 'related'
    ];

    const optionFlags = commitCmd.options.map(o => o.long.replace(/^--/, ''));
    for (const opt of contractOptions) {
      expect(optionFlags).toContain(opt);
    }
    
    // Verify short alias for interactive (the only one in 0.5.0)
    const interactiveOpt = commitCmd.options.find(o => o.long === '--interactive');
    expect(interactiveOpt?.short).toBe('-i');

    // Verify removal of short aliases for others
    const intentOpt = commitCmd.options.find(o => o.long === '--intent');
    expect(intentOpt?.short).toBeUndefined();

    const bodyOpt = commitCmd.options.find(o => o.long === '--body');
    expect(bodyOpt?.short).toBeUndefined();

    const fileOpt = commitCmd.options.find(o => o.long === '--file');
    expect(fileOpt?.short).toBeUndefined();
  });

  it('CONTRACT: commit options must have 0.5.0 matching descriptions', async () => {
    const { program } = await buildLoreCli();
    const commitCmd = program.commands.find(c => c.name() === 'commit')!;

    const descriptions: Record<string, string> = {
      'intent': 'Intent line (why the change was made)',
      'body': 'Body (narrative context)',
      'file': 'Read JSON input from file',
      'interactive': 'Interactive mode (guided prompts)'
    };

    for (const [opt, desc] of Object.entries(descriptions)) {
      const option = commitCmd.options.find(o => o.long === `--${opt}`);
      expect(option?.description).toBe(desc);
    }
  });

  it('CONTRACT: global options must not have -C or -V aliases', async () => {
    const { program } = await buildLoreCli();
    
    const contextOpt = program.options.find(o => o.long === '--context');
    expect(contextOpt?.short).toBeUndefined();

    const versionOpt = program.options.find(o => o.long === '--version');
    expect(versionOpt?.short).toBeUndefined();
  });

  it('CONTRACT: log command must support all 0.5.0 options', async () => {
    const { program } = await buildLoreCli();
    const logCmd = program.commands.find(c => c.name() === 'log')!;
    
    const contractOptions = ['limit', 'max-commits', 'since'];
    const optionFlags = logCmd.options.map(o => o.long.replace(/^--/, ''));
    
    for (const opt of contractOptions) {
      expect(optionFlags).toContain(opt);
    }
  });

  it('ADDITIVE: log command should have new engine-powered filters', async () => {
    const { program } = await buildLoreCli();
    const logCmd = program.commands.find(c => c.name() === 'log')!;
    
    const newOptions = ['scope', 'follow', 'all', 'author', 'until'];
    const optionFlags = logCmd.options.map(o => o.long.replace(/^--/, ''));
    
    for (const opt of newOptions) {
      expect(optionFlags, 'Engine power is missing from Lore wrapper').toContain(opt);
    }
  });

  it('CONTRACT: trace command must support --max-depth', async () => {
    const { program } = await buildLoreCli();
    const traceCmd = program.commands.find(c => c.name() === 'trace')!;
    
    const optionFlags = traceCmd.options.map(o => o.long.replace(/^--/, ''));
    expect(optionFlags).toContain('max-depth');
  });

  it('CONTRACT: stale command must support all 0.5.0 thresholds', async () => {
    const { program } = await buildLoreCli();
    const staleCmd = program.commands.find(c => c.name() === 'stale')!;
    
    const contractOptions = ['older-than', 'drift', 'low-confidence'];
    const optionFlags = staleCmd.options.map(o => o.long.replace(/^--/, ''));
    
    for (const opt of contractOptions) {
      expect(optionFlags).toContain(opt);
    }
  });
});
