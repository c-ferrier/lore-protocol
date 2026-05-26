import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerInitCommand } from '../../../../src/lore/commands/init.js';
import type { IOutputFormatter } from '../../../../src/engine/interfaces/output-formatter.js';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { LORE_CONFIG_DIR as CONFIG_DIR, LORE_CONFIG_FILENAME as CONFIG_FILENAME, LORE_DEFAULT_ENGINE_CONFIG } from '../../../../src/lore/defaults.js';

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
  } as any;

  const MOCK_ENGINE_DEPS = {
    getFormatter: () => formatter,
    engineDirName: '.atom',
    configFileName: 'config.toml',
    defaultConfig: LORE_DEFAULT_ENGINE_CONFIG,
  };

  let consoleLogSpy: any;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('creates new config files and .gitignore if they do not exist', async () => {
    const program = new Command();
    registerInitCommand(program, MOCK_ENGINE_DEPS);

    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.readFile).mockImplementation(async (path: any) => {
        if (path.toString().endsWith('.gitignore')) throw new Error('ENOENT');
        return '';
    });

    await program.parseAsync(['node', 'lore', 'init']);

    // 1. Core Engine (.atom)
    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('.atom'), { recursive: true });

    // 2. Discovery Protocol (.atom/protocols/lore.toml)
    expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.atom/protocols/lore.toml'),
        expect.stringContaining('name = "Lore"'),
        'utf-8'
    );

    // 3. Legacy Lore (.lore/config.toml)
    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('.lore'), { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(join(CONFIG_DIR, CONFIG_FILENAME)),
      expect.stringContaining('[protocol]'),
      'utf-8'
    );
    
    // 4. Gitignore
    const gitignoreCalls = vi.mocked(fs.writeFile).mock.calls.filter(c => c[0].toString().endsWith('.gitignore'));
    expect(gitignoreCalls[gitignoreCalls.length - 1][1]).toContain('.atom/cache');
  });

  it('reports an existing valid config with no gaps using 0.5.0 spec', async () => {
    const fullConfig = `[protocol]
version = "1.0"
[trailers]
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
update_check = true
`;
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockImplementation(async (path: any) => {
      if (path.toString().endsWith('.gitignore')) return '.atom/cache\n';
      return fullConfig;
    });

    const program = new Command();
    registerInitCommand(program, MOCK_ENGINE_DEPS);

    await program.parseAsync(['node', 'lore', 'init']);

    // Should NOT have warning about missing options
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('SUCCESS: Your configuration is missing new options:'));
  });

  it('reports missing sections based on the 0.5.0 spec', async () => {
    const minimalConfig = `[protocol]\nversion = "1.0"\n`;
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockImplementation(async (path: any) => {
      if (path.toString().endsWith('.gitignore')) return '.atom/cache\n';
      return minimalConfig;
    });

    const program = new Command();
    registerInitCommand(program, MOCK_ENGINE_DEPS);

    await program.parseAsync(['node', 'lore', 'init']);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('SUCCESS: Your configuration is missing new options:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('- [trailers] section'));
  });

  it('detects missing keys within a section', async () => {
    const partialConfig = `[protocol]
version = "1.0"
[trailers]
required = []
custom = []
[validation]
strict = false
# intent_max_length is missing
`;
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockImplementation(async (path: any) => {
      if (path.toString().endsWith('.gitignore')) return '.atom/cache\n';
      return partialConfig;
    });

    const program = new Command();
    registerInitCommand(program, MOCK_ENGINE_DEPS);

    await program.parseAsync(['node', 'lore', 'init']);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('- validation.intent_max_length'));
  });
});
