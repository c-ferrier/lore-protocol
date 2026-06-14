import * as fs from 'node:fs/promises';

import { Command } from 'commander';
import { beforeEach,describe, expect, it, vi } from 'vitest';

import { registerInitCommand } from '../../../../src/engine/cli/commands/init.js';
import { EngineConfig } from '../../../../src/engine/core/types/config.js';
import { type MockedOutputFormatter } from '../../../mock-types.js';
import { TestLogger } from '../../engine-test-utils.js';

vi.mock('node:fs/promises');

describe('Engine registerInitCommand', () => {
  const formatter: MockedOutputFormatter = {
    formatSuccess: vi.fn((msg) => `SUCCESS: ${msg}`),
    formatError: vi.fn((_code, messages) => `ERROR: ${messages[0].message}`),
    formatQueryResult: vi.fn(),
    formatValidationResult: vi.fn(),
    formatStalenessResult: vi.fn(),
    formatTraceResult: vi.fn(),
    formatDoctorResult: vi.fn(),
    formatConfigResult: vi.fn(),
  } as unknown as MockedOutputFormatter;

  let logger: TestLogger;

  const MOCK_CONFIG: EngineConfig = {
    cache: { 
        query: true,
        identity: true,
        pruneThreshold: 100
    },
    cli: { 
        updateCheck: true, 
    },
    validation: { 
        subjectMaxLength: 72,
        maxMessageLines: 50
    },
    stale: { olderThan: '6m', driftThreshold: 20 },
    output: { defaultFormat: 'text' },
    follow: { maxDepth: 3 },
    protocols: {}
  };

  const MOCK_DEPS = {
    getFormatter: () => formatter,
    engineDirName: '.atom',
    configFileName: 'config.toml',
    logger: null as unknown as TestLogger,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    logger = new TestLogger();
    MOCK_DEPS.logger = logger;
  });

  it('should create .atom directory and default config.toml', async () => {
    const program = new Command();
    registerInitCommand(program, MOCK_DEPS, MOCK_CONFIG);

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
    expect(logger.infoLogs.some(l => l.includes('Created .atom/config.toml'))).toBe(true);
  });

  it('should not overwrite existing config.toml', async () => {
    const program = new Command();
    registerInitCommand(program, MOCK_DEPS, MOCK_CONFIG);

    vi.mocked(fs.access).mockResolvedValue(undefined); // File exists

    await program.parseAsync(['node', 'atom', 'init']);

    expect(fs.writeFile).not.toHaveBeenCalledWith(
        expect.stringContaining('.atom/config.toml'),
        expect.anything(),
        expect.anything()
    );
    expect(logger.infoLogs.some(l => l.includes('Config already exists'))).toBe(true);
  });

  it('should update .gitignore if cache pattern is missing', async () => {
    const program = new Command();
    registerInitCommand(program, MOCK_DEPS, MOCK_CONFIG);

    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('node_modules\n');

    await program.parseAsync(['node', 'atom', 'init']);

    expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.gitignore'),
        expect.stringContaining('.atom/cache'),
        'utf-8'
    );
    expect(logger.infoLogs.some(l => l.includes('Updated .gitignore'))).toBe(true);
  });
});