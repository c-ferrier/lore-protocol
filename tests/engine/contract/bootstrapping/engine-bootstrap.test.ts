import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EngineBootstrapper } from '../../../../src/engine/services/engine-bootstrapper.js';
import { TEST_ENGINE_CONFIG } from '../../engine-test-utils.js';
import { LogLevel } from '../../../../src/engine/interfaces/logger.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';

// Mock dependency services to avoid FS/Git access
vi.mock('../../../../src/engine/services/git-client.js', () => ({
    GitClient: vi.fn().mockImplementation(() => ({
        resolveRef: vi.fn(async () => 'head'),
        resolveDate: vi.fn(async () => new Date()),
    }))
}));

vi.mock('../../../../src/engine/services/config-loader.js', () => ({
    EngineConfigLoader: vi.fn().mockImplementation(() => ({
        loadForPath: vi.fn(async () => TEST_ENGINE_CONFIG),
    }))
}));

vi.mock('../../../../src/engine/services/root-resolver.js', () => ({
    resolveProtocolRoot: vi.fn(async () => ({ protocolRoot: '/mock', gitRoot: '/mock' })),
}));

vi.mock('../../../../src/engine/services/protocol-loader.js', () => ({
    DynamicProtocolLoader: vi.fn().mockImplementation(() => ({
        loadAll: vi.fn(async () => []),
    }))
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
    expect((config as any).custom).toBe('value');
  });

  it('should allow wrappers to mutate protocols via hooks', async () => {
    const onProtocolsLoaded = vi.fn(async (protos) => [...protos, { name: 'Hooked', version: '1.0', namespace: '', trailers: {}, identityKey: 'id' } as any]);
    const bootstrapper = new EngineBootstrapper({ ...options, onProtocolsLoaded });
    
    const { sharedDeps } = await bootstrapper.bootstrap('/mock', []);
    
    expect(onProtocolsLoaded).toHaveBeenCalled();
    expect(sharedDeps.protocolRegistry.get('Hooked')).toBeDefined();
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
