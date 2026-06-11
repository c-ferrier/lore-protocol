import { beforeEach,describe, expect, it, vi } from 'vitest';

import { ProtocolMap } from '../../../src/engine/core/models/protocol-map.js';
import { type Atom } from '../../../src/engine/core/types/domain.js';
import { type RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { findAtomsByIds } from '../../../src/engine/shell/orchestrators/discovery.js';
import { makeStubProtocolContext, type ProtocolContext } from '../../../src/engine/testing.js';
import { type MockedGitClient } from '../../mock-types.js';
import { makeMockGitClient, makeMockInfra } from '../engine-test-utils.js';

describe('Discovery Batch Disambiguation', () => {
  let git: MockedGitClient;
  let protocols: ProtocolMap<ProtocolContext>;

  const ALPHA_DEF = { name: 'Alpha', namespace: 'alpha', identityKey: 'Alpha-id' };
  const BETA_DEF = { name: 'Beta', namespace: 'beta', identityKey: 'Beta-id' };

  beforeEach(() => {
    git = makeMockGitClient();

    protocols = new ProtocolMap();
    protocols.set('alpha', makeStubProtocolContext(ALPHA_DEF));
    protocols.set('beta', makeStubProtocolContext(BETA_DEF));
  });

  it('findAtomsByIds: should correctly hydrate a mixed batch of identities', async () => {
    const c1: RawCommit = { 
        hash: 'h1', date: new Date().toISOString(), author: 'a', subject: 's', body: 'b', 
        trailers: 'alpha: Alpha-id: aaaa1111',
        filesChanged: []
    };
    const c2: RawCommit = { 
        hash: 'h2', date: new Date().toISOString(), author: 'a', subject: 's', body: 'b', 
        trailers: 'beta: Beta-id: bbbb2222',
        filesChanged: []
    };

    vi.mocked(git.queryStream).mockImplementation(async function* () { yield* [c1, c2]; });

    const infra = makeMockInfra({ git, protocols });
    const results = await findAtomsByIds(infra, [
      { id: 'aaaa1111', protocol: 'alpha' },
      { id: 'bbbb2222', protocol: 'beta' }
    ]);

    expect(results).toHaveLength(2);
    expect(results.find((a: Atom) => a.commitHash === 'h1')?.protocols.has('alpha')).toBe(true);
    expect(results.find((a: Atom) => a.commitHash === 'h2')?.protocols.has('beta')).toBe(true);
    
    // Verify query patterns
    const query = vi.mocked(git.queryStream).mock.calls[0][0];
    expect(query.regexPatterns).toContainEqual(['^alpha: Alpha-id: aaaa1111$', '^beta: Beta-id: bbbb2222$']);
  });
});