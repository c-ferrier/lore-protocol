import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
    TEST_ENGINE_CONFIG, 
    makeProtocol, 
    makeProtocolRegistry, 
    makeCommitInput
} from '../engine-test-utils.js';
import { validateFormatting } from '../../../src/engine/logic/commit-formatting.js';

describe('Strict Namespaced Validation', () => {

  beforeEach(() => {
  });

  it('should reject orphan trailers in a strict namespaced protocol', async () => {
    // 1. Create a STRICT, non-permissive protocol in namespace "fred"
    const strictProtocol = makeProtocol(
        { name: 'Fred', namespace: 'fred', identityKey: 'Fred-id' },
        { strict: true, permissive: false }
    );
    const registry = makeProtocolRegistry([strictProtocol]);
    
    // 2. Input with an orphan trailer in "fred" namespace
    const input = makeCommitInput({
      subject: 'feat: add feature',
      trailers: {
        'fred': { 
            'Fred-id': ['12345678'],
            'Orphan': ['value'] // Not defined in Fred schema
        }
      },
    });

    const issues = await validateFormatting(input, TEST_ENGINE_CONFIG, registry);
    
    // Should report that 'Orphan' is not allowed
    expect(issues.some(i => i.severity === 'error' && i.message.includes('not recognized'))).toBe(true);
  });

  it('should accept valid trailers in a strict namespaced protocol', async () => {
    const strictProtocol = makeProtocol(
        { name: 'Fred', namespace: 'fred', identityKey: 'Fred-id' },
        { strict: true, permissive: false }
    );
    const registry = makeProtocolRegistry([strictProtocol]);
    
    const input = makeCommitInput({
      subject: 'feat: add feature',
      trailers: {
        'fred': { 
            'Fred-id': ['12345678']
        }
      },
    });

    const issues = await validateFormatting(input, TEST_ENGINE_CONFIG, registry);
    const errors = issues.filter(i => i.severity === 'error');
    if (errors.length !== 0) console.log('ERRORS (Strict):', errors);
    expect(errors).toHaveLength(0);
  });

  it('should report missing required trailers in a strict namespaced protocol', async () => {
    const strictProtocol = makeProtocol(
        { 
            name: 'Fred', 
            namespace: 'fred', 
            identityKey: 'Fred-id',
            trailers: {
                'Fred-id': { type: 'string', required: true, description: 'ID', aliases: [], ui: { kind: 'identity', color: 'dim' } as any }
            }
        },
        { 
            strict: true, 
            permissive: false,
            trailers: {
                'Fred-id': { description: 'ID', multivalue: false, validation: 'none', generator: 'none', required: true }
            }
        }
    );

    const registry = makeProtocolRegistry([strictProtocol]);

    const input = makeCommitInput({
      subject: 'feat: add feature',
      trailers: {
        'fred': { 
            // Missing Fred-id
            'Other': ['val']
        }
      },
    });

    const issues = await validateFormatting(input, TEST_ENGINE_CONFIG, registry);
    expect(issues.some(i => i.rule === 'fred-id-present' && i.field === 'fred:Fred-id')).toBe(true);
  });

  it('should report unauthorized trailers in a strict namespace', async () => {
    const strictProtocol = makeProtocol(
        { name: 'Fred', namespace: 'fred', identityKey: 'Fred-id' },
        { strict: true, permissive: false }
    );
    const registry = makeProtocolRegistry([strictProtocol]);

    const input = makeCommitInput({
      subject: 'feat: add feature',
      trailers: {
        'fred': { 
            'Fred-id': ['12345678'],
            'Unknown-key': ['value'] // Truly unknown key
        }
      },
    });

    const issues = await validateFormatting(input, TEST_ENGINE_CONFIG, registry);
    expect(issues.some(i => i.rule === 'unauthorized-trailer' && i.field === 'fred:Unknown-key')).toBe(true);
  });
});
