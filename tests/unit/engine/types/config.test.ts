import { describe, it, expect } from 'vitest';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG, makeProtocol } from '../test-utils.js';

describe('Protocol configuration merging', () => {
  it('should identify custom keys in permissive mode', () => {
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, {
      trailers: {
        permissive: true,
        definitions: { 
          Team: { description: 'T', multivalue: false, validation: 'none' as const },
          Dept: { description: 'D', multivalue: false, validation: 'none' as const } 
        },
      }
    });
    const customKeys = protocol.getAuthorizedKeys().filter(k => !protocol.isCore(k));
    expect(customKeys).toContain('Team');
    expect(customKeys).toContain('Dept');
  });
});
