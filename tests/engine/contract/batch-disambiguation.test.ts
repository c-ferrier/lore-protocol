import { type RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { makeProtocol } from '../../../src/engine/testing.js';
import { makeAtomRepository, makeMockGitClient } from '../engine-test-utils.js';

import { describe, it, expect, vi, beforeEach } from 'vitest';
;


;

describe('AtomRepository Batch Disambiguation', () => {
  let gitClient: any;
  let repo: any;
  let registry: ProtocolRegistry;

  const ALPHA_DEF = { name: 'Alpha', namespace: 'alpha', identityKey: 'Alpha-id' };
  const BETA_DEF = { name: 'Beta', namespace: 'beta', identityKey: 'Beta-id' };

  beforeEach(() => {
    gitClient = makeMockGitClient();

    registry = new ProtocolRegistry();
    registry.register(makeProtocol(ALPHA_DEF));
    registry.register(makeProtocol(BETA_DEF));

    repo = makeAtomRepository({ gitClient, registry });
  });

  it('findByIds: should correctly hydrate a mixed batch of identities', async () => {
    const c1: RawCommit = { 
        hash: 'h1', date: new Date().toISOString(), author: 'a', subject: 's', body: 'b', 
        trailers: 'alpha: Alpha-id: aaaa1111' 
    };
    const c2: RawCommit = { 
        hash: 'h2', date: new Date().toISOString(), author: 'a', subject: 's', body: 'b', 
        trailers: 'beta: Beta-id: bbbb2222' 
    };

    vi.mocked(gitClient.query).mockResolvedValue([c1, c2]);

    const results = await repo.findByIds([
      { id: 'aaaa1111', protocol: 'alpha' },
      { id: 'bbbb2222', protocol: 'beta' }
    ]);

    expect(results).toHaveLength(2);
    expect(results.find(a => a.commitHash === 'h1')?.protocols.has('alpha')).toBe(true);
    expect(results.find(a => a.commitHash === 'h2')?.protocols.has('beta')).toBe(true);
    
    // Verify query patterns
    const query = vi.mocked(gitClient.query).mock.calls[0][0];
    expect(query.regexPatterns).toContainEqual(['^alpha: Alpha-id: aaaa1111$', '^beta: Beta-id: bbbb2222$']);
  });
});