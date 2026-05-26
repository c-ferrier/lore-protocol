import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerCommitCommand } from '../../../../src/engine/commands/commit.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { LoreProtocolDefinition } from '../../../../src/lore/protocol-definition.js';
import { LORE_DEFAULT_CONFIG } from '../../../../src/lore/defaults.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';

describe('lore commit (dynamic flags)', () => {
  const mockDeps = {
    commitBuilder: { build: vi.fn(), validate: vi.fn(() => []) },
    gitClient: { commit: vi.fn().mockResolvedValue({ hash: 'h1', rawMessage: 'm' }), hasStagedChanges: vi.fn().mockResolvedValue(true) },
    getFormatter: () => ({ formatSuccess: vi.fn() }),
    commitInputResolver: { resolve: vi.fn().mockResolvedValue({ subject: 'i' }) },
    headIdReader: { readIds: vi.fn().mockResolvedValue({}) },
    trailerParser: new TrailerParser(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register flags for custom trailers defined in config', async () => {
    const config = {
      ...LORE_DEFAULT_CONFIG,
      trailers: {
        ...LORE_DEFAULT_CONFIG.trailers,
        definitions: {
          Department: {
            description: 'Dept',
            multivalue: false,
            validation: 'none' as const,
            cli: { flag: 'dept' }
          }
        }
      }
    };
    const protocol = new Protocol(LoreProtocolDefinition, config);
    const protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(protocol);

    const program = new Command();
    
    registerCommitCommand(program, { ...mockDeps, config, protocol, protocolRegistry });
    
    const commitCmd = program.commands.find(c => c.name() === 'commit');
    expect(commitCmd).toBeDefined();
    
    const deptOption = commitCmd?.options.find(o => o.long === '--dept');
    expect(deptOption).toBeDefined();
    expect(deptOption?.description).toContain('Dept');
  });

  it('should automatically slugify custom trailer keys into flags', async () => {
    const config = {
      ...LORE_DEFAULT_CONFIG,
      trailers: {
        ...LORE_DEFAULT_CONFIG.trailers,
        definitions: {
          'Assisted-by': {
            description: 'A',
            multivalue: true,
            validation: 'none' as const
          }
        }
      }
    };
    const protocol = new Protocol(LoreProtocolDefinition, config);
    const protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(protocol);

    const program = new Command();
    
    registerCommitCommand(program, { ...mockDeps, config, protocol, protocolRegistry });
    
    const commitCmd = program.commands.find(c => c.name() === 'commit');
    const assistedOption = commitCmd?.options.find(o => o.long === '--assisted-by');
    expect(assistedOption).toBeDefined();
  });
});
