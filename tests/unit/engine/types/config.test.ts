import { describe, it, expect } from 'vitest';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG, makeProtocol } from '../test-utils.js';

describe('Protocol configuration merging', () => {
  it('should identify custom keys in permissive mode', () => {
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, {
      trailers: {
        permissive: true,
        custom: ['Team'],
        definitions: { Dept: { description: 'D', multivalue: false, validation: 'none' as const } },
      }
    });
    const customKeys = protocol.getAuthorizedKeys().filter(k => !protocol.isCore(k));
    expect(customKeys).toContain('Team');
    expect(customKeys).toContain('Dept');
  });

  it('should union custom array and definitions keys and deduplicate them', () => {
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, {
      trailers: {
        permissive: false,
        custom: ['Team', 'Project'],
        definitions: { 
          Dept: { description: 'D', multivalue: false, validation: 'none' as const },
          Project: { description: 'P', multivalue: false, validation: 'none' as const } // Duplicate
        },
      }
    });
    const customKeys = protocol.getAuthorizedKeys().filter(k => !protocol.isCore(k));
    
    expect(customKeys).toContain('Team');
    expect(customKeys).toContain('Project');
    expect(customKeys).toContain('Dept');
    expect(customKeys.length).toBe(3); // Deduplicated by Protocol engine
  });
});
