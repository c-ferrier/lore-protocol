import { describe, expect, it, vi } from 'vitest';

import { LogLevel } from '../../../../src/engine/interfaces/logger.js';
import { type IPrompt } from '../../../../src/engine/interfaces/prompt.js';
import { EngineBootstrapper } from '../../../../src/engine/services/engine-bootstrapper.js';
import { makeStubProtocolContext,TEST_ENGINE_CONFIG } from '../../../../src/engine/testing.js';

// Mock dependency services to avoid FS/Git access
vi.mock('../../../../src/engine/shell/git/git-client.js', () => ({
    GitClient: class {
        resolveRef = vi.fn(async () => 'head');
        resolveDate = vi.fn(async () => new Date());
    }
}));

vi.mock('../../../../src/engine/shell/fs/config-loader.js', () => ({
    EngineConfigLoader: class {
        loadForPath = vi.fn(async () => TEST_ENGINE_CONFIG);
    }
}));

vi.mock('../../../../src/engine/shell/fs/root-resolver.js', () => ({
    resolveProtocolRoot: vi.fn(async () => ({ protocolRoot: '/mock', isScoped: false })),
}));

vi.mock('../../../../src/engine/shell/fs/protocol-loader.js', () => ({
    DynamicProtocolLoader: class {
        loadAll = vi.fn(async () => []);
    },
    ProtocolLoader: Object.assign(
        class {
            loadAll = vi.fn(async () => []);
        },
        {
            applyOverrides: vi.fn((defs) => defs)
        }
    )
}));


describe('EngineBootstrapper', () => {
  const options = {
    binaryName: 'test-cli',
    version: '1.0.0',
    description: 'Test CLI Description',
    engineDirName: '.test-engine',
    configFileName: 'config.toml',
    defaultConfig: TEST_ENGINE_CONFIG,
    staticProtocols: [],
    prompt: { askConfirm: vi.fn(), askChoice: vi.fn(), askInput: vi.fn(), askText: vi.fn(), askMultiline: vi.fn(), close: vi.fn() } as unknown as IPrompt,
    logLevel: LogLevel.SILENT
  };

  it('should initialize the commander program with correct metadata', async () => {
    const bootstrapper = new EngineBootstrapper(options);
    const { program } = await bootstrapper.bootstrap('/mock', []);

    expect(program.name()).toBe('test-cli');
    expect(program.version()).toBe('1.0.0');
    expect(program.description()).toBe('Test CLI Description');
  });

  it('should register all expected commands', async () => {
    const bootstrapper = new EngineBootstrapper(options);
    const { program } = await bootstrapper.bootstrap('/mock', []);

    const commandNames = program.commands.map(c => c.name());
    expect(commandNames).toContain('why');
    expect(commandNames).toContain('search');
    expect(commandNames).toContain('log');
    expect(commandNames).toContain('stale');
    expect(commandNames).toContain('trace');
    expect(commandNames).toContain('commit');
    expect(commandNames).toContain('validate');
    expect(commandNames).toContain('squash');
    expect(commandNames).toContain('cache');
    expect(commandNames).toContain('config');
    expect(commandNames).toContain('doctor');
  });

  it('should allow wrappers to mutate config via hooks', async () => {
    const onConfigLoaded = vi.fn(async (cfg) => ({ ...cfg, custom: 'value' }));
    const bootstrapper = new EngineBootstrapper({ ...options, onConfigLoaded });
    
    const { config } = await bootstrapper.bootstrap('/mock', []);
    
    expect(onConfigLoaded).toHaveBeenCalled();
    expect((config as unknown as { custom: string }).custom).toBe('value');
  });

  it('should allow wrappers to mutate protocols via hooks', async () => {
    const onProtocolsLoaded = vi.fn(async (protos) => [...protos, makeStubProtocolContext({ 
        name: 'Hooked', 
        namespace: '', 
        identityKey: 'id', 
        trailers: { 'id': { description: 'ID', multivalue: false, validation: 'none' } } 
    })]);
    const bootstrapper = new EngineBootstrapper({ ...options, onProtocolsLoaded });

    const { sharedDeps } = await bootstrapper.bootstrap('/mock', []);

    expect(onProtocolsLoaded).toHaveBeenCalled();
    expect(sharedDeps.protocolRegistry.get('hooked')).toBeDefined();
  });

  it('should configure the formatter based on CLI options', async () => {
    const bootstrapper = new EngineBootstrapper(options);
    
    // Simulate --json flag
    // Commander parse is picky, so we just manually set the options for testing the factory
    const { program, getFormatter } = await bootstrapper.bootstrap('/mock', ['--json']);
    
    // Manually inject options into program for the factory
    vi.spyOn(program, 'opts').mockReturnValue({ json: true, format: 'json' });

    const formatter = getFormatter();
    expect(formatter.constructor.name).toBe('JsonFormatter');
  });
});
