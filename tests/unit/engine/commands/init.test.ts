import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerInitCommand } from '../../../../src/engine/commands/init.js';
import type { IOutputFormatter } from '../../../../src/engine/interfaces/output-formatter.js';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';

vi.mock('node:fs/promises');

describe('Engine registerInitCommand', () => {
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

  const MOCK_DEPS = {
    getFormatter: () => formatter,
    engineDirName: '.atom',
    configFileName: 'config.toml',
    defaultConfig: {
      cli: { updateCheck: true, cache: true },
      validation: { subjectMaxLength: 72 }
    } as any,
  };

  let consoleLogSpy: any;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should create .atom directory and default config.toml', async () => {
    const program = new Command();
    registerInitCommand(program, MOCK_DEPS);

    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.readFile).mockResolvedValue('');

    await program.parseAsync(['node', 'atom', 'init']);

    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('.atom'), { recursive: true });
    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('.atom/protocols'), { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.atom/config.toml'),
        expect.stringContaining('update_check = true'),
        'utf-8'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Created .atom/config.toml'));
  });

  it('should not overwrite existing config.toml', async () => {
    const program = new Command();
    registerInitCommand(program, MOCK_DEPS);

    vi.mocked(fs.access).mockResolvedValue(undefined); // File exists

    await program.parseAsync(['node', 'atom', 'init']);

    expect(fs.writeFile).not.toHaveBeenCalledWith(
        expect.stringContaining('.atom/config.toml'),
        expect.anything(),
        expect.anything()
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Config already exists'));
  });

  it('should update .gitignore if cache pattern is missing', async () => {
    const program = new Command();
    registerInitCommand(program, MOCK_DEPS);

    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('node_modules\n');

    await program.parseAsync(['node', 'atom', 'init']);

    expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.gitignore'),
        expect.stringContaining('.atom/cache'),
        'utf-8'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Updated .gitignore'));
  });
});
