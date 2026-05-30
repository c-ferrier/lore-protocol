import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
    TEST_ENGINE_CONFIG, 
    makeProtocol, 
    makeProtocolRegistry, 
    makeMockGitClient, 
    makeMockAtomRepository, 
    makeRawCommit, 
    makeValidator 
} from '../test-utils.js';
import { CommitBuilder } from '../../../../src/engine/services/commit-builder.js';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import { IdGenerator } from '../../../../src/engine/services/id-generator.js';
import type { CommitInput } from '../../../../src/engine/types/commit.js';

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
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0);
  });
});
