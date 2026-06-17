import { describe, expect,it } from 'vitest';

import { 
    getAuthorizedKeys, 
    isCoreTrailer} from '../../../src/core/logic/protocols.js';
import { makeStubProtocolContext,TEST_PROTOCOL_DEFINITION } from '../../../src/testing.js';

describe('Protocol configuration merging', () => {
  it('should identify custom keys in permissive mode', () => {
    const protocol = makeStubProtocolContext({
      ...TEST_PROTOCOL_DEFINITION,
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