import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerConfigCommand } from '../../../../src/engine/cli/commands/config.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { makeMockContext as makeMockProtocol } from '../../../../src/engine/testing.js';

describe('Config Command', () => {
  let program: Command;
  let registry: ProtocolRegistry;
  let logger: any;
  let formatter: any;

  beforeEach(() => {
    program = new Command();
    registry = new ProtocolRegistry();
    logger = { result: vi.fn() };
    formatter = { formatConfig: vi.fn().mockReturnValue('formatted') };

    const lore = makeMockProtocol({ 
        name: 'Lore', 
        namespace: '',
        trailers: { 
            Confidence: { description: 'C', isCore: true },
            Legacy: { description: 'L', isCore: false }
        } as any
    });
    const sec = makeMockProtocol({ 
        name: 'Sec', 
        namespace: 'sec',
        trailers: { 
            Level: { description: 'S', isCore: true } 
        } as any
    });
    
    registry.register(lore);
    registry.register(sec);

    registerConfigCommand(program, {
      config: {} as any,
      getFormatter: () => formatter,
      protocolRegistry: registry,
      logger,
    });
  });

  it('should pass all protocols to the formatter by default', async () => {
    await program.parseAsync(['node', 'test', 'config']);
    
    const result = formatter.formatConfig.mock.calls[0][0];
    expect(result.protocols).toHaveLength(2);
    expect(result.protocols[0].trailers).toHaveProperty('Confidence');
    expect(result.protocols[0].trailers).toHaveProperty('Legacy');
    expect(result.protocols[1].trailers).toHaveProperty('Level');
  });

  it('should filter by protocol name (case-insensitive substring)', async () => {
    await program.parseAsync(['node', 'test', 'config', '--protocol', 'lo']);
    
    const result = formatter.formatConfig.mock.calls[0][0];
    expect(result.protocols).toHaveLength(1);
    expect(result.protocols[0].name).toBe('lore');
  });

  it('should filter by trailer type (core)', async () => {
    await program.parseAsync(['node', 'test', 'config', '--trailer-type', 'core']);
    
    const result = formatter.formatConfig.mock.calls[0][0];
    expect(result.protocols[0].trailers).toHaveProperty('Confidence');
    expect(result.protocols[0].trailers).not.toHaveProperty('Legacy');
  });

  it('should filter by trailer type (custom)', async () => {
    await program.parseAsync(['node', 'test', 'config', '--trailer-type', 'custom']);
    
    const result = formatter.formatConfig.mock.calls[0][0];
    expect(result.protocols[0].trailers).not.toHaveProperty('Confidence');
    expect(result.protocols[0].trailers).toHaveProperty('Legacy');
  });

  it('should filter by trailer name (case-insensitive substring)', async () => {
    await program.parseAsync(['node', 'test', 'config', '--trailer-name', 'conf']);
    
    const result = formatter.formatConfig.mock.calls[0][0];
    expect(result.protocols[0].trailers).toHaveProperty('Confidence');
    expect(result.protocols[0].trailers).not.toHaveProperty('Legacy');
  });
});
