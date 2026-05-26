import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { runCli } from '../../../src/engine/index.js';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import * as rootResolver from '../../../src/engine/services/root-resolver.js';

describe('Engine Assembly (Agnostic Bootstrap)', () => {
  const testDir = join(tmpdir(), `engine-bootstrap-${Date.now()}`);
  const pkgPath = join(testDir, 'package.json');

  const CUSTOM_PROTOCOL = {
    name: 'Custom',
    version: '1.0',
    identityKey: 'Custom-id',
    namespace: 'custom',
    trailers: {}
  };

  const MOCK_CONFIG = {
    protocol: { name: 'Atom', version: '1.0' },
    trailers: { required: [], custom: [], definitions: {}, permissive: true },
    validation: { strict: false, maxMessageLines: 50, subjectMaxLength: 72 },
    stale: { olderThan: '6m', driftThreshold: 20 },
    output: { defaultFormat: 'text' },
    follow: { maxDepth: 3 },
    cli: { updateCheck: false, cache: true, queryCache: true }
  } as any;

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(pkgPath, JSON.stringify({ version: '1.0.0' }));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should bootstrap the engine with a custom protocol and no Lore mentions', async () => {
    const { program, sharedDeps } = await runCli({
      binaryName: 'test-atom',
      description: 'Test Engine',
      engineDirName: '.test-atom',
      configFileName: 'config.toml',
      defaultConfig: MOCK_CONFIG,
      staticProtocols: [CUSTOM_PROTOCOL],
      packageJsonPath: pkgPath
    });

    expect(program.name()).toBe('test-atom');
    expect(sharedDeps.protocol.name).toBe('Custom');
    expect(sharedDeps.protocol.namespace).toBe('custom');
    
    // Verify services are wired correctly
    expect(sharedDeps.atomRepository).toBeDefined();
    expect(sharedDeps.gitClient).toBeDefined();
    
    // Check for "Lore" leakage in help text
    const helpText = program.helpInformation();
    expect(helpText).not.toContain('Lore');
    expect(helpText).toContain('test-atom');
    expect(helpText).toContain('Custom'); // Protocol name should be present
  });

  it('should support running with zero protocols initially', async () => {
    // This tests the "atom" CLI scenario
    const { program } = await runCli({
      binaryName: 'atom',
      description: 'Agnostic',
      engineDirName: '.atom',
      configFileName: 'config.toml',
      defaultConfig: MOCK_CONFIG,
      staticProtocols: [], // Atom starts empty
      packageJsonPath: pkgPath
    });

    expect(program).toBeDefined();
    expect(program.name()).toBe('atom');
  });

  it('should determine isScoped=true when protocol root is a subdirectory of git root', async () => {
    const spy = vi.spyOn(rootResolver, 'resolveProtocolRoot').mockResolvedValue({
      protocolRoot: '/repo/sub',
      gitRoot: '/repo'
    });

    const { sharedDeps } = await runCli({
      binaryName: 'atom',
      description: 'Agnostic',
      engineDirName: '.atom',
      configFileName: 'config.toml',
      defaultConfig: MOCK_CONFIG,
      staticProtocols: [],
      packageJsonPath: pkgPath
    });

    expect((sharedDeps.atomRepository as any).isScoped).toBe(true);
    spy.mockRestore();
  });

  it('should determine isScoped=false when protocol root is the git root', async () => {
    const spy = vi.spyOn(rootResolver, 'resolveProtocolRoot').mockResolvedValue({
      protocolRoot: '/repo',
      gitRoot: '/repo'
    });

    const { sharedDeps } = await runCli({
      binaryName: 'atom',
      description: 'Agnostic',
      engineDirName: '.atom',
      configFileName: 'config.toml',
      defaultConfig: MOCK_CONFIG,
      staticProtocols: [],
      packageJsonPath: pkgPath
    });

    expect((sharedDeps.atomRepository as any).isScoped).toBe(false);
    spy.mockRestore();
  });
});
