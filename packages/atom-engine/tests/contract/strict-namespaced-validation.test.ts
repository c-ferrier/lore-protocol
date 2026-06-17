import { beforeEach,describe, expect, it } from 'vitest';

import { validateFormatting } from '../../src/core/logic/commit-formatting.js';
import { ProtocolMap } from '../../src/core/models/protocol-map.js';
import { makeCommitInput, makeStubProtocolContext, type ProtocolContext,TEST_ENGINE_CONFIG } from '../../src/testing.js';

describe('Strict Namespaced Validation', () => {

  beforeEach(() => {
  });

  it('should reject orphan trailers in a strict namespaced protocol', async () => {
    // 1. Create a STRICT, non-permissive protocol in namespace "fred"
    const strictProtocol = makeStubProtocolContext(
        { name: 'Fred', namespace: 'fred', identityKey: 'Mock-id' },
        { strict: true, permissive: false }
    );
    const protocols = new ProtocolMap<ProtocolContext>();
    protocols.set(strictProtocol.name, strictProtocol);
    
    // 2. Input with an orphan trailer in "fred" namespace
    const input = makeCommitInput({
      subject: 'feat: add feature',
      trailers: new ProtocolMap([['fred', { 
            'Mock-id': ['12345678'],
            'Orphan': ['value'] // Not defined in Fred schema
        }]]),
    });

    const issues = validateFormatting(input,
 TEST_ENGINE_CONFIG, protocols);
    
    // Should report that 'Orphan' is not allowed
    expect(issues.some(i => i.severity === 'error' && i.rule === 'unauthorized-trailer' && i.field === 'fred:Orphan')).toBe(true);
  });

  it('should accept valid trailers in a strict namespaced protocol', async () => {
    const strictProtocol = makeStubProtocolContext(
        { name: 'Fred', namespace: 'fred', identityKey: 'Mock-id' },
        { strict: true, permissive: false }
    );
    const protocols = new ProtocolMap<ProtocolContext>();
    protocols.set(strictProtocol.name, strictProtocol);
    
    const input = makeCommitInput({
      subject: 'feat: add feature',
      trailers: new ProtocolMap([['fred', { 
            'Mock-id': ['12345678']
        }]])
    });

    const issues = validateFormatting(input,
 TEST_ENGINE_CONFIG, protocols);
    const errors = issues.filter(i => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('should report missing required trailers in a strict namespaced protocol', async () => {
    const strictProtocol = makeStubProtocolContext(
        { 
            name: 'Fred', 
            namespace: 'fred', 
            identityKey: 'Mock-id',
            strict: true, 
            permissive: false,
            trailers: {
                'Mock-id': { description: 'ID', multivalue: false, validation: 'none' as const, generator: 'none', required: true, ui: { kind: 'identity', color: 'dim' } }
            }
        }
    );

    const protocols = new ProtocolMap<ProtocolContext>();
    protocols.set(strictProtocol.name, strictProtocol);

    const input = makeCommitInput({
      subject: 'feat: add feature',
      trailers: new ProtocolMap([['fred', { 
            // Missing Mock-id
            'Other': ['val']
        }]])
    });

    const issues = validateFormatting(input,
 TEST_ENGINE_CONFIG, protocols);
    expect(issues.some(i => i.rule === 'fred-id-present' && i.field === 'fred:Mock-id')).toBe(true);
  });

  it('should report unauthorized trailers in a strict namespace', async () => {
    const strictProtocol = makeStubProtocolContext(
        { name: 'Fred', namespace: 'fred', identityKey: 'Mock-id' },
        { strict: true, permissive: false }
    );
    const protocols = new ProtocolMap<ProtocolContext>();
    protocols.set(strictProtocol.name, strictProtocol);

    const input = makeCommitInput({
      subject: 'feat: add feature',
      trailers: new ProtocolMap([['fred', { 
            'Mock-id': ['12345678'],
            'Unknown-key': ['value'] // Truly unknown key
        }]]),
    });

    const issues = validateFormatting(input,
 TEST_ENGINE_CONFIG, protocols);
    expect(issues.some(i => i.rule === 'unauthorized-trailer' && i.field === 'fred:Unknown-key')).toBe(true);
  });
});