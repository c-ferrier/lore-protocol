import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { Validator } from '../../../src/engine/services/validator.js';
import { TEST_ENGINE_CONFIG, makeProtocolConfig, makeMockGitClient } from '../engine-test-utils.js';
import type { ProtocolDefinition } from '../../../src/engine/interfaces/protocol-definition.js';

describe('Cross-Protocol Reference Validation', () => {
  let validator: Validator;
  let registry: ProtocolRegistry;
  let gitClient: any;

  const ALPHA_DEF: ProtocolDefinition = {
    name: 'Alpha',
    version: '1.0',
    identityKey: 'Alpha-id',
    namespace: 'alpha',
    trailers: {
      'Alpha-id': { description: 'ID', validation: 'pattern' as const, pattern: '^[0-9]+$' },
      'Depends-on': { description: 'Dep', validation: 'reference' as const, crossProtocol: true }
    }
  };

  const BETA_DEF: ProtocolDefinition = {
    name: 'Beta',
    version: '1.0',
    identityKey: 'Beta-id',
    namespace: 'beta',
    trailers: {
      'Beta-id': { description: 'ID', validation: 'pattern' as const, pattern: '^[a-z]+$' },
      'Internal-link': { description: 'Int', validation: 'reference' as const, crossProtocol: false }
    }
  };

  beforeEach(() => {
    registry = new ProtocolRegistry();
    const alpha = new Protocol(ALPHA_DEF, makeProtocolConfig({ permissive: false }));
    const beta = new Protocol(BETA_DEF, makeProtocolConfig({ permissive: false }));
    registry.register(alpha);
    registry.register(beta);

    gitClient = makeMockGitClient();

    const mockRepo = {
      findByIds: vi.fn(async () => []),
    } as any;

    validator = new Validator(mockRepo, TEST_ENGINE_CONFIG, registry);
  });

  it('should allow valid cross-protocol references', async () => {
    const rawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: 'alpha: Alpha-id: 123\nalpha: Depends-on: beta/abc'
    } as any;

    const results = await validator.validate([rawCommit]);
    expect(results[0].issues.filter(i => i.rule === 'invalid-reference-format')).toHaveLength(0);
  });

  it('should flag unknown protocol prefixes', async () => {
    const rawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: 'alpha: Alpha-id: 123\nalpha: Depends-on: ghost/999'
    } as any;

    const results = await validator.validate([rawCommit]);
    const issue = results[0].issues.find(i => i.rule === 'unknown-protocol-prefix');
    expect(issue).toBeDefined();
    // Message: [Alpha] Unknown protocol prefix: "ghost" in identity "ghost/999"
    expect(issue?.message).toContain('Unknown protocol prefix: "ghost"');
  });

  it('should flag cross-protocol links when crossProtocol is false', async () => {
    const rawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: 'beta: Beta-id: abc\nbeta: Internal-link: alpha/123'
    } as any;

    const results = await validator.validate([rawCommit]);
    const issue = results[0].issues.find(i => i.rule === 'cross-protocol-prohibited');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('does not allow cross-protocol references');
  });

  it('should validate format against the TARGET protocol rules', async () => {
    const rawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: 'alpha: Alpha-id: 123\nalpha: Depends-on: beta/123' // Beta IDs must be a-z
    } as any;

    const results = await validator.validate([rawCommit]);
    const issue = results[0].issues.find(i => i.rule === 'invalid-reference-format');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('not a valid identifier for protocol "beta"');
  });
});
