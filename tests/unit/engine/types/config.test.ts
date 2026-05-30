import { describe, it, expect } from 'vitest';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { TEST_PROTOCOL_DEFINITION, TEST_ENGINE_CONFIG, makeProtocol } from '../test-utils.js';

describe('Protocol configuration merging', () => {
  it('should identify custom keys in permissive mode', () => {
    const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION, {
      strict: false, 
      permissive: true,
      trailers: { 
        Team: { description: 'T', multivalue: false, validation: 'none' as const },
        Dept: { description: 'D', multivalue: false, validation: 'none' as const } 
      },
    });
    const customKeys = protocol.getAuthorizedKeys().filter(k => !protocol.isCore(k));
    expect(customKeys).toContain('Team');
    expect(customKeys).toContain('Dept');
  });
});
