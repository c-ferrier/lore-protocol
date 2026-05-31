import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
    TEST_ENGINE_CONFIG, 
    makeProtocol, 
    makeProtocolRegistry, 
    makeMockGitClient, 
    makeMockAtomRepository, 
    makeRawCommit, 
    makeValidator 
} from '../engine-test-utils.js';
import { CommitBuilder } from '../../../src/engine/services/commit-builder.js';
import { TrailerParser } from '../../../src/engine/services/trailer-parser.js';
import { IdGenerator } from '../../../src/engine/services/id-generator.js';
import type { CommitInput } from '../../../src/engine/types/commit.js';

describe('Strict Namespaced Validation', () => {
  let parser: TrailerParser;
  let idGen: IdGenerator;

  beforeEach(() => {
    parser = new TrailerParser();
    idGen = new IdGenerator();
  });

  it('should reject orphan trailers in a strict namespaced protocol', async () => {
    // 1. Create a STRICT, non-permissive protocol in namespace "fred"
    const strictProtocol = makeProtocol(
        { name: 'Fred', namespace: 'fred', identityKey: 'Fred-id' },
        { strict: true, permissive: false }
    );
    const registry = makeProtocolRegistry([strictProtocol]);
    
    const builder = new CommitBuilder(parser, idGen, TEST_ENGINE_CONFIG, registry);

    // 2. Input with an orphan trailer in "fred" namespace
    const input: CommitInput = {
      subject: 'feat: add feature',
      trailers: {
        'fred': { 
            'Fred-id': ['12345678'],
            'Orphan': ['value'] // Not defined in Fred schema
        }
      },
    };

    const issues = builder.validate(input);
    
    // console.log('DEBUG: protocol.permissive =', strictProtocol.permissive);
    // console.log('DEBUG: issues =', JSON.stringify(issues, null, 2));

    // Should report that 'Orphan' is not allowed
    expect(issues.some(i => i.severity === 'error' && i.message.includes('not recognized'))).toBe(true);
  });

  it('should accept valid trailers in a strict namespaced protocol', async () => {
    const strictProtocol = makeProtocol(
        { name: 'Fred', namespace: 'fred', identityKey: 'Fred-id' },
        { strict: true, permissive: false }
    );
    const registry = makeProtocolRegistry([strictProtocol]);
    
    const builder = new CommitBuilder(parser, idGen, TEST_ENGINE_CONFIG, registry);

    const input: CommitInput = {
      subject: 'feat: add feature',
      trailers: {
        'fred': { 
            'Fred-id': ['12345678']
        }
      },
    };

    const issues = builder.validate(input);
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
        { strict: true, permissive: false }
    );
    // Explicitly remove generator to force requirement check
    delete strictProtocol.definition.trailers['Fred-id'].generator;
    
    const registry = makeProtocolRegistry([strictProtocol]);
    const builder = new CommitBuilder(parser, idGen, TEST_ENGINE_CONFIG, registry);

    const input: CommitInput = {
      subject: 'feat: add feature',
      trailers: {
        'fred': { 
            // Missing Fred-id
            'Other': ['val']
        }
      },
    };

    const issues = builder.validate(input);
    if (issues.length === 0 || !issues.some(i => i.rule === 'fred-id-present' && i.field === 'fred:Fred-id')) {
        console.log('DEBUG (Missing Required):', JSON.stringify(issues, null, 2));
    }
    expect(issues.some(i => i.rule === 'fred-id-present' && i.field === 'fred:Fred-id')).toBe(true);
  });

  it('should report unauthorized trailers in a strict namespace', async () => {
    const strictProtocol = makeProtocol(
        { name: 'Fred', namespace: 'fred', identityKey: 'Fred-id' },
        { strict: true, permissive: false }
    );
    const registry = makeProtocolRegistry([strictProtocol]);
    const builder = new CommitBuilder(parser, idGen, TEST_ENGINE_CONFIG, registry);

    const input: CommitInput = {
      subject: 'feat: add feature',
      trailers: {
        'fred': { 
            'Fred-id': ['12345678'],
            'Unknown-key': ['value'] // Truly unknown key
        }
      },
    };

    const issues = builder.validate(input);
    if (issues.length === 0 || !issues.some(i => i.rule === 'unauthorized-trailer' && i.field === 'fred:Unknown-key')) {
        console.log('DEBUG (Unauthorized Key):', JSON.stringify(issues, null, 2));
    }
    expect(issues.some(i => i.rule === 'unauthorized-trailer' && i.field === 'fred:Unknown-key')).toBe(true);
  });
});
