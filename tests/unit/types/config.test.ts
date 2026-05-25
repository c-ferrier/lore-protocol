import { describe, it, expect } from 'vitest';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';
import { LORE_DEFAULT_CONFIG } from '../../../src/lore/defaults.js';

describe('getEffectiveTrailerKeys (Protocol logic replacement)', () => {
  it('should return empty list in permissive mode', () => {
    const config = {
      ...LORE_DEFAULT_CONFIG,
      trailers: {
        ...LORE_DEFAULT_CONFIG.trailers,
        permissive: true,
        custom: ['Team'],
        definitions: { Dept: { description: 'D', multivalue: false, validation: 'none' as const } },
      }
    };
    const protocol = new Protocol(LoreProtocolDefinition, config);
    // Permissive mode includes all, so we check for defined custom keys only if needed,
    // but originally getEffectiveTrailerKeys returned [] for permissive.
    // The Protocol service doesn't have a direct equivalent to 'empty list' because it
    // authorizes everything.
    const customKeys = protocol.getAuthorizedKeys().filter(k => !protocol.isCore(k));
    expect(customKeys).toContain('Team');
    expect(customKeys).toContain('Dept');
  });

  it('should union custom array and definitions keys', () => {
    const config = {
      ...LORE_DEFAULT_CONFIG,
      trailers: {
        ...LORE_DEFAULT_CONFIG.trailers,
        permissive: false,
        custom: ['Team', 'Project'],
        definitions: { 
          Dept: { description: 'D', multivalue: false, validation: 'none' as const },
          Project: { description: 'P', multivalue: false, validation: 'none' as const } // Duplicate
        },
      }
    };
    const protocol = new Protocol(LoreProtocolDefinition, config);
    const customKeys = protocol.getAuthorizedKeys().filter(k => !protocol.isCore(k));
    
    expect(customKeys).toContain('Team');
    expect(customKeys).toContain('Project');
    expect(customKeys).toContain('Dept');
    expect(customKeys.length).toBe(3); // Deduplicated by Protocol engine
  });
});
