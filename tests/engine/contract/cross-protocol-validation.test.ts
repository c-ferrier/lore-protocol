import { beforeEach,describe, expect, it } from 'vitest';

import { hydrateAtoms } from '../../../src/engine/core/logic/hydration.js';
import { type ProtocolDefinition } from '../../../src/engine/core/types/protocol-definition.js';
import { RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { validateCommits } from '../../../src/engine/shell/orchestrators/validation.js';
import { makeStubProtocolContext,TEST_ENGINE_CONFIG } from '../../../src/engine/testing.js';
import { makeMockAtomRepository } from '../engine-test-utils.js';

describe('Cross-Protocol Reference Validation', () => {
  let registry: ProtocolRegistry;
  let mockRepo: ReturnType<typeof makeMockAtomRepository>;

  const ALPHA_DEF: ProtocolDefinition = {
    name: 'AlphaVal',
    version: '1.0',
    strict: true,
    permissive: false,
    identityKey: 'Alpha-id',
    namespace: 'alphaval',
    trailers: {
      'Alpha-id': { description: 'ID', multivalue: false, validation: 'pattern' as const, pattern: '^[0-9]+$' },
      'Depends-on': { description: 'Dep', multivalue: true, validation: 'reference' as const, crossProtocol: true }
    }
  };

  const BETA_DEF: ProtocolDefinition = {
    name: 'BetaVal',
    version: '1.0',
    strict: true,
    permissive: false,
    identityKey: 'Beta-id',
    namespace: 'betaval',
    trailers: {
      'Beta-id': { description: 'ID', multivalue: false, validation: 'pattern' as const, pattern: '^[a-z]+$' },
      'Internal-link': { description: 'Int', multivalue: true, validation: 'reference' as const, crossProtocol: false }
    }
  };

  beforeEach(() => {
    registry = new ProtocolRegistry();
    const alpha = makeStubProtocolContext(ALPHA_DEF, { permissive: false });
    const beta = makeStubProtocolContext(BETA_DEF, { permissive: false });
    registry.register(alpha);
    registry.register(beta);

    mockRepo = makeMockAtomRepository();
  });

  const getDeps = () => ({
    atomRepository: mockRepo,
    config: TEST_ENGINE_CONFIG,
    protocolRegistry: registry
  });

  it('should allow valid cross-protocol references', async () => {
    const rawCommit: RawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: 'alphaval: Alpha-id: 123\nalphaval: Depends-on: betaval/abc',
      filesChanged: []
    };

    const results = await validateCommits(hydrateAtoms([rawCommit], registry, { includeAllCommits: true }), getDeps());
    expect(results[0].issues.filter(i => i.rule === 'invalid-reference-format')).toHaveLength(0);
  });

  it('should flag unknown protocol prefixes', async () => {
    const rawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: 'alphaval: Alpha-id: 123\nalphaval: Depends-on: ghost/999'
    } as any;

    const results = await validateCommits(hydrateAtoms([rawCommit], registry, { includeAllCommits: true }), getDeps());
    const issue = results[0].issues.find(i => i.rule === 'unknown-protocol-prefix');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('Unknown protocol prefix: "ghost"');
  });

  it('should flag cross-protocol links when crossProtocol is false', async () => {
    const rawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: 'betaval: Beta-id: abc\nbetaval: Internal-link: alphaval/123'
    } as any;

    const results = await validateCommits(hydrateAtoms([rawCommit], registry, { includeAllCommits: true }), getDeps());
    const issue = results[0].issues.find(i => i.rule === 'cross-protocol-prohibited');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('does not allow cross-protocol references');
  });

  it('should validate format against the TARGET protocol rules', async () => {
    const rawCommit: RawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: 'alphaval: Alpha-id: 123\nalphaval: Depends-on: betaval/123', // Beta IDs must be a-z
      filesChanged: []
    };

    const results = await validateCommits(hydrateAtoms([rawCommit], registry, { includeAllCommits: true }), getDeps());
    const issue = results[0].issues.find(i => i.rule === 'invalid-reference-format');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('not a valid identifier for protocol "betaval"');
  });
});
