import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { Validator } from '../../../../src/engine/services/validator.ts';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import type { IGitClient } from '../../../../src/engine/interfaces/git-client.js';
import { makeProtocolConfig, TEST_ENGINE_CONFIG } from '../test-utils.js';

describe('Cross-Protocol Validation', () => {
  let registry: ProtocolRegistry;
  let validator: Validator;
  let gitClient: IGitClient;

  const ALPHA_DEF: ProtocolDefinition = {
    name: 'Alpha',
    version: '1.0',
    identityKey: 'Alpha-id',
    namespace: '',
    strict: false,
    permissive: false,
    trailers: {
      'Alpha-id': { description: 'ID', validation: 'pattern' as const, pattern: '^[0-9]+$', isCore: true },
      'Depends-on': { description: 'Dep', validation: 'reference' as const, crossProtocol: true, isCore: true }
    }
  };

  const BETA_DEF: ProtocolDefinition = {
    name: 'Beta',
    version: '1.0',
    identityKey: 'Beta-id',
    namespace: '',
    strict: false,
    permissive: false,
    trailers: {
      'Beta-id': { description: 'ID', validation: 'pattern' as const, pattern: '^[a-z]+$', isCore: true },
      'Internal-link': { description: 'Int', validation: 'reference' as const, crossProtocol: false, isCore: true }
    }
  };

  beforeEach(() => {
    registry = new ProtocolRegistry();
    const alpha = new Protocol(ALPHA_DEF, makeProtocolConfig({ permissive: false }));
    const beta = new Protocol(BETA_DEF, makeProtocolConfig({ permissive: false }));
    registry.register(alpha);
    registry.register(beta);

    gitClient = {
      log: vi.fn(async () => []),
      isInsideRepo: vi.fn(async () => true),
    } as any;

    const mockRepo = {
      findByIds: vi.fn(async () => []),
    } as any;

    validator = new Validator(new TrailerParser(), mockRepo, TEST_ENGINE_CONFIG, registry);
  });

  it('should allow valid cross-protocol references', async () => {
    const commit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: 'Alpha-id: 123\nDepends-on: beta/abc'
    };

    const results = await validator.validate([commit]);
    
    // It should NOT have format errors. (It might have reference-exists warning if not found, which is fine)
    const formatIssues = results[0].issues.filter(i => i.rule === 'invalid-reference-format' || i.rule === 'unknown-protocol-prefix');
    expect(formatIssues).toHaveLength(0);
  });

  it('should flag unknown protocol prefixes', async () => {
    const commit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: 'Alpha-id: 123\nDepends-on: ghost/999'
    };

    const results = await validator.validate([commit]);
    const issue = results[0].issues.find(i => i.rule === 'unknown-protocol-prefix');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('Unknown protocol prefix: "ghost"');
  });

  it('should flag cross-protocol links when crossProtocol is false', async () => {
    const commit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: 'Beta-id: abc\nInternal-link: alpha/123'
    };

    const results = await validator.validate([commit]);
    const issue = results[0].issues.find(i => i.rule === 'cross-protocol-prohibited');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('does not allow cross-protocol references');
  });

  it('should validate format against the TARGET protocol rules', async () => {
    const commit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: 'Alpha-id: 123\nDepends-on: beta/123' // Beta expects [a-z]+
    };

    const results = await validator.validate([commit]);
    const issue = results[0].issues.find(i => i.rule === 'invalid-reference-format');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('not a valid identifier for protocol "Beta"');
  });
});
