import { describe, it, expect } from 'vitest';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG } from '../test-utils.js';

describe('Protocol configuration merging', () => {
  it('should identify custom keys in permissive mode', () => {
    const config = {
      ...MOCK_CONFIG,
      trailers: {
        ...MOCK_CONFIG.trailers,
        permissive: true,
        custom: ['Team'],
        definitions: { Dept: { description: 'D', multivalue: false, validation: 'none' as const } },
      }
    };
    const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, config);
    const customKeys = protocol.getAuthorizedKeys().filter(k => !protocol.isCore(k));
    expect(customKeys).toContain('Team');
    expect(customKeys).toContain('Dept');
  });

  it('should union custom array and definitions keys and deduplicate them', () => {
    const config = {
      ...MOCK_CONFIG,
      trailers: {
        ...MOCK_CONFIG.trailers,
        permissive: false,
        custom: ['Team', 'Project'],
        definitions: { 
          Dept: { description: 'D', multivalue: false, validation: 'none' as const },
          Project: { description: 'P', multivalue: false, validation: 'none' as const } // Duplicate
        },
      }
    };
    const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, config);
    const customKeys = protocol.getAuthorizedKeys().filter(k => !protocol.isCore(k));
    
    expect(customKeys).toContain('Team');
    expect(customKeys).toContain('Project');
    expect(customKeys).toContain('Dept');
    expect(customKeys.length).toBe(3); // Deduplicated by Protocol engine
  });
});
