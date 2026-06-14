import { beforeEach,describe, expect, it } from 'vitest';

import { hydrateAtoms } from '../../../src/engine/core/logic/hydration.js';
import { ProtocolMap } from '../../../src/engine/core/models/protocol-map.js';
import { type ProtocolDefinition } from '../../../src/engine/core/types/protocol-definition.js';
import { type RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { validateCommits } from '../../../src/engine/shell/orchestrators/validation.js';
import { makeStubProtocolContext, type ProtocolContext,TEST_ENGINE_CONFIG } from '../../../src/engine/testing.js';
import { makeMockInfra } from '../engine-test-utils.js';

describe('Cross-Protocol Reference Validation', () => {
  let protocols: ProtocolMap<ProtocolContext>;

  const ALPHA_DEF: ProtocolDefinition = {
    name: 'AlphaVal',
    version: '1.0',
    strict: true,
    permissive: false,
    namespace: 'alphaval',
    identityKey: 'Alpha-id',
    trailers: {
      'Alpha-id': { description: 'ID', multivalue: false, validation: 'none' },
      'Depends-on': { description: 'Ref', multivalue: true, validation: 'reference', crossProtocol: true }
    }
  };

  const BETA_DEF: ProtocolDefinition = {
    name: 'BetaVal',
    version: '1.0',
    strict: true,
    permissive: false,
    namespace: 'betaval',
    identityKey: 'Beta-id',
    trailers: {
      'Beta-id': { description: 'ID', multivalue: false, validation: 'pattern', pattern: '^[a-z]+$' },
      'Internal-link': { description: 'Ref', multivalue: true, validation: 'reference', crossProtocol: false }
    }
  };

  beforeEach(() => {
    protocols = new ProtocolMap();
    const alpha = makeStubProtocolContext(ALPHA_DEF, { permissive: false });
    const beta = makeStubProtocolContext(BETA_DEF, { permissive: false });
    protocols.set(alpha.name, alpha);
    protocols.set(beta.name, beta);
  });

  const getInfra = () => makeMockInfra({
    protocols,
    config: TEST_ENGINE_CONFIG
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

    const infra = getInfra();
    const results = await validateCommits(hydrateAtoms([rawCommit], protocols, { includeAllCommits: true }), infra);
    expect(results[0].issues.filter(i => i.rule === 'invalid-reference-format')).toHaveLength(0);
  });

  it('should flag unknown protocol prefixes', async () => {
    const rawCommit: RawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: 'alphaval: Alpha-id: 123\nalphaval: Depends-on: ghost/999',
      filesChanged: []
    };

    const infra = getInfra();
    const results = await validateCommits(hydrateAtoms([rawCommit], protocols, { includeAllCommits: true }), infra);
    const issue = results[0].issues.find(i => i.rule === 'unknown-protocol-prefix');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('Unknown protocol: "ghost"');
  });

  it('should flag cross-protocol links when crossProtocol is false', async () => {
    const rawCommit: RawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: 'betaval: Beta-id: abc\nbetaval: Internal-link: alphaval/123',
      filesChanged: []
    };

    const infra = getInfra();
    const results = await validateCommits(hydrateAtoms([rawCommit], protocols, { includeAllCommits: true }), infra);
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

    const infra = getInfra();
    const results = await validateCommits(hydrateAtoms([rawCommit], protocols, { includeAllCommits: true }), infra);
    const issue = results[0].issues.find(i => i.rule === 'invalid-reference-format');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('not a valid identifier for protocol "betaval"');
  });
});
