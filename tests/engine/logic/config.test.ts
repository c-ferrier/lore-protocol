import { TEST_PROTOCOL_DEFINITION, makeProtocol } from '../../../src/engine/testing.js';
import { 
    isCoreTrailer, 
    getAuthorizedKeys 
} from '../../../src/engine/core/logic/protocols.js';

import { describe, it, expect } from 'vitest';

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
    const customKeys = getAuthorizedKeys(protocol).filter(k => !isCoreTrailer(k, protocol));
    expect(customKeys).toContain('Team');
    expect(customKeys).toContain('Dept');
  });
});