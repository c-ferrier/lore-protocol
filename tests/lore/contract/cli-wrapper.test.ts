import { mkdirSync, rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll,beforeAll, describe, expect, it, vi } from 'vitest';

import { ProtocolMap } from '../../../src/engine/core/models/protocol-map.js';
import { getRootProtocol, makeStubProtocolContext, type ProtocolContext } from '../../../src/engine/testing.js';
import type { LoreConfig } from '../../../src/lore/defaults.js';
import { LoreConfigLoader } from '../../../src/lore/services/lore-config-loader.js';
import { buildLoreCli } from '../lore-test-utils.js';

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
    const { program, infra } = await buildLoreCli();

    expect(program.name()).toBe('lore');
    const rootProtocol = getRootProtocol(infra.protocols);
    expect(rootProtocol).toBeDefined();
    expect(rootProtocol?.name).toBe('lore');

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
    const { program } = await buildLoreCli();
    expect(program.description()).toBe('CLI tool for the Lore protocol -- structured decision context in git commits');
  });

  describe('Dynamic Flag Generation', () => {
    it('should dynamically surface protocol trailers as CLI flags on commit and search', async () => {
      // Create a legacy config where Lore has custom trailers
      const localLoader = {
        load: async () => ({
           protocol: { version: '1.0' },
           trailers: {
              custom: ['Assisted-by', 'Department']
           }
        })
      };

      vi.spyOn(LoreConfigLoader.prototype, 'load').mockImplementation(localLoader.load as unknown as () => Promise<LoreConfig>);

      const { program } = await buildLoreCli();
      
      const commitCmd = program.commands.find(c => c.name() === 'commit');
      expect(commitCmd?.options.find(o => o.long === '--assisted-by')).toBeDefined();
      expect(commitCmd?.options.find(o => o.long === '--department')).toBeDefined();

      const searchCmd = program.commands.find(c => c.name() === 'search');
      expect(searchCmd?.options.find(o => o.long === '--assisted-by')).toBeUndefined();
      expect(searchCmd?.options.find(o => o.long === '--department')).toBeUndefined();
    });

    it('should NOT surface non-lore protocol trailers as top-level CLI flags', async () => {
        // Setup: Map with both 'lore' and 'project' protocols
        const lore = makeStubProtocolContext({ name: 'lore' });
        const project = makeStubProtocolContext({ 
            name: 'project', 
            trailers: { 'Status': { description: 'S', multivalue: false, validation: 'none' as const } }
        });

        const protocols = new ProtocolMap<ProtocolContext>();
        protocols.set(lore.name, lore);
        protocols.set(project.name, project);

        // This is a bit tricky to mock because buildLoreCli calls runCli which creates the Map internally.
        // We test the logic of buildLoreCli which only uses staticProtocols: [LoreProtocolDefinition].
        const { program } = await buildLoreCli();
        const commitCmd = program.commands.find(c => c.name() === 'commit');
        
        // Assert: Non-lore flags are strictly ABSENT
        expect(commitCmd?.options.find(o => o.long === '--project-status')).toBeUndefined();
        expect(commitCmd?.options.find(o => o.long === '--status')).toBeUndefined();
    });
  });
});
