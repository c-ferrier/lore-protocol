import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerInitCommand } from '../../../../src/lore/commands/init.js';
import type { IOutputFormatter } from '../../../../src/engine/interfaces/output-formatter.js';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { LORE_CONFIG_DIR as CONFIG_DIR, LORE_CONFIG_FILENAME as CONFIG_FILENAME } from '../../../../src/lore/defaults.js';

vi.mock('node:fs/promises');

describe('registerInitCommand', () => {
  const formatter: IOutputFormatter = {
    formatSuccess: vi.fn((msg) => `SUCCESS: ${msg}`),
    formatError: vi.fn((code, messages) => `ERROR: ${messages[0].message} (code ${code})`),
    formatQueryResult: vi.fn(),
    formatValidationResult: vi.fn(),
    formatStalenessResult: vi.fn(),
    formatTraceResult: vi.fn(),
    formatDoctorResult: vi.fn(),
    formatConfig: vi.fn(),
    formatMetricsResult: vi.fn(),
  };

  let consoleLogSpy: any;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('creates a new config file and .gitignore if they do not exist', async () => {
    const program = new Command();
    registerInitCommand(program, { getFormatter: () => formatter, protocolName: 'Lore' });

    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

    await program.parseAsync(['node', 'lore', 'init']);

    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining(CONFIG_DIR), { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(join(CONFIG_DIR, CONFIG_FILENAME)),
      expect.stringContaining('[protocol]'),
      'utf-8'
    );
    // Check .gitignore creation
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.gitignore'),
      expect.stringContaining('.lore/cache'),
      'utf-8'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Created .lore/config.toml'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Created .gitignore to ignore .lore/cache'));
  });

  it('updates existing .gitignore if .lore/cache is missing', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined); // config exists
    vi.mocked(fs.readFile).mockImplementation(async (path: any) => {
      if (path.toString().endsWith('.gitignore')) return 'node_modules\n';
      // Mock valid TOML for the config file check
      return '[protocol]\nname = "Lore"\nversion = "1.0"\n';
    });

    const program = new Command();
    registerInitCommand(program, { getFormatter: () => formatter, protocolName: 'Lore' });

    await program.parseAsync(['node', 'lore', 'init']);

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.gitignore'),
      'node_modules\n.lore/cache\n',
      'utf-8'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Updated .gitignore to ignore .lore/cache'));
  });

  it('reports an existing valid config with no gaps', async () => {
    const fullConfig = `[protocol]
name = "Lore"
version = "1.0"
[trailers]
permissive = true
required = []
custom = []
[validation]
strict = false
max_message_lines = 50
intent_max_length = 72
[stale]
older_than = "6m"
drift_threshold = 20
[output]
default_format = "text"
[follow]
max_depth = 3
[cli]
cache = true
query_cache = true
query_cache_prune_threshold = 100
update_check = true
`;
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockImplementation(async (path: any) => {
      if (path.toString().endsWith('.gitignore')) return '.lore/cache\n';
      return fullConfig;
    });

    const program = new Command();
    registerInitCommand(program, { getFormatter: () => formatter, protocolName: 'Lore' });

    await program.parseAsync(['node', 'lore', 'init']);

    // Should NOT have warning about missing options
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('SUCCESS: Your configuration is missing new options:'));
  });

  it('reports missing options and suggests safe reset if no customizations exist', async () => {
    const minimalConfig = `[protocol]
  name = "Lore"
  version = "1.0"
  `;
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockImplementation(async (path: any) => {
      if (path.toString().endsWith('.gitignore')) return '.lore/cache\n';
      return minimalConfig;
    });

    const program = new Command();
    registerInitCommand(program, { getFormatter: () => formatter, protocolName: 'Lore' });

    await program.parseAsync(['node', 'lore', 'init']);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('SUCCESS: Your configuration is missing new options:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('- [trailers] section'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Notice: You are using default settings. You can safely reset your config'));
  });

  it('reports missing options and suggests manual merge if customizations exist', async () => {
    const customizedConfig = `[protocol]
  name = "Lore"
  version = "1.0"
  [validation]
  strict = true
  `;
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockImplementation(async (path: any) => {
      if (path.toString().endsWith('.gitignore')) return '.lore/cache\n';
      return customizedConfig;
    });

    const program = new Command();
    registerInitCommand(program, { getFormatter: () => formatter, protocolName: 'Lore' });

    await program.parseAsync(['node', 'lore', 'init']);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('SUCCESS: Your configuration is missing new options:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Notice: You have customized the following options:'));
  });

  it('reports individual missing keys when section exists', async () => {

    const configWithMissingKey = `[protocol]
    name = "Lore"
    version = "1.0"
    [trailers]
    permissive = true
    required = []
    custom = []
    [validation]
    strict = false
    max_message_lines = 50
    intent_max_length = 72
    [stale]
    older_than = "6m"
    drift_threshold = 20
    [output]
    default_format = "text"
    [follow]
    # max_depth is missing
    [cli]
    cache = true
    query_cache = true
    query_cache_prune_threshold = 100
    update_check = true
    `;
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockImplementation(async (path: any) => {
      if (path.toString().endsWith('.gitignore')) return '.lore/cache\n';
      return configWithMissingKey;
    });

    const program = new Command();
    registerInitCommand(program, { getFormatter: () => formatter, protocolName: 'Lore' });

    await program.parseAsync(['node', 'lore', 'init']);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('SUCCESS: Your configuration is missing new options:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('- follow.max_depth'));
    });

  it('correctly maps snake_case TOML keys to camelCase config properties', async () => {
    // validation.intentMaxLength is represented as validation.intent_max_length in TOML
    const configWithSnakeCase = `[protocol]
name = "Lore"
version = "1.0"
[trailers]
permissive = true
required = []
custom = []
[validation]
strict = false
max_message_lines = 50
intent_max_length = 72
[stale]
older_than = "6m"
drift_threshold = 20
[output]
default_format = "text"
[follow]
max_depth = 3
[cli]
cache = true
query_cache = true
query_cache_prune_threshold = 100
update_check = true
`;
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockImplementation(async (path: any) => {
      if (path.toString().endsWith('.gitignore')) return '.lore/cache\n';
      return configWithSnakeCase;
    });

    const program = new Command();
    registerInitCommand(program, { getFormatter: () => formatter, protocolName: 'Lore' });

    await program.parseAsync(['node', 'lore', 'init']);

    // Should NOT report missing options because snake_case mapping should work
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Your configuration is missing new options:'));
  });

  it('ignores trailers.definitions dictionary during gap detection (extensibility)', async () => {
    const configWithDefinitions = `[protocol]
name = "Lore"
version = "1.0"
[trailers]
permissive = true
required = []
custom = []
[trailers.definitions.Team]
description = "T"
multivalue = false
validation = "none"
[validation]
strict = false
max_message_lines = 50
intent_max_length = 72
[stale]
older_than = "6m"
drift_threshold = 20
[output]
default_format = "text"
[follow]
max_depth = 3
[cli]
cache = true
query_cache = true
query_cache_prune_threshold = 100
update_check = true
`;
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockImplementation(async (path: any) => {
      if (path.toString().endsWith('.gitignore')) return '.lore/cache\n';
      return configWithDefinitions;
    });

    const program = new Command();
    registerInitCommand(program, { getFormatter: () => formatter, protocolName: 'Lore' });

    await program.parseAsync(['node', 'lore', 'init']);

    // Should NOT report missing or customized options because of trailers.definitions
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Your configuration is missing new options:'));
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Notice: You have customized the following options:'));
  });

  it('updates description based on protocol name', () => {
    const program = new Command();
    registerInitCommand(program, { getFormatter: () => formatter, protocolName: 'Fred' });
    const initCmd = program.commands.find(c => c.name() === 'init');
    expect(initCmd?.description()).toContain('.fred/');
  });

  it('reports corruption if the existing config is invalid TOML', async () => {
    const corruptedConfig = `[protocol]
  version = "1.0
  invalid = [missing bracket
  `;
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockImplementation(async (path: any) => {
      if (path.toString().endsWith('.gitignore')) return '.lore/cache\n';
      return corruptedConfig;
    });

    const program = new Command();
    program.exitOverride();
    registerInitCommand(program, { getFormatter: () => formatter, protocolName: 'Lore' });

    await expect(program.parseAsync(['node', 'lore', 'init']))
      .rejects.toThrow(/Your configuration file is corrupted/);
  });
});
