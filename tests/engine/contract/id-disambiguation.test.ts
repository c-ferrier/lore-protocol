import { beforeEach,describe, expect, it, vi } from 'vitest';

import { type RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { makeAtomRepository, makeStubProtocolContext } from '../../../src/engine/testing.js';
import { makeMockGitClient, MockedGitClient } from '../engine-test-utils.js';

describe('AtomRepository Identity Disambiguation', () => {
  let gitClient: MockedGitClient;
  let repo: AtomRepository;
  let protocolRegistry: ProtocolRegistry;

  const ALPHA_DEF = {
    name: 'Alpha',
    version: '1.0',
    identityKey: 'Alpha-id',
    namespace: 'alpha',
    trailers: {
      'Alpha-id': { description: 'ID', multivalue: false, validation: 'pattern' as const, pattern: '^[0-9a-f]{8}$' },
    }
  };

  const BETA_DEF = {
    name: 'Beta',
    version: '1.0',
    identityKey: 'Beta-id',
    namespace: 'beta',
    trailers: {
      'Beta-id': { description: 'ID', multivalue: false, validation: 'pattern' as const, pattern: '^[0-9a-f]{8}$' },
    }
  };

  beforeEach(() => {
    gitClient = makeMockGitClient();

    protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(makeStubProtocolContext(ALPHA_DEF));
    protocolRegistry.register(makeStubProtocolContext(BETA_DEF));

    repo = makeAtomRepository({
        gitClient,
        protocolRegistry,
    });
  });

  it('should find an atom using a qualified ID (alpha/12345678)', async () => {
    const targetId = '12345678';
    const commit: RawCommit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: `alpha: Alpha-id: ${targetId}`,
      filesChanged: [],
    };

    vi.mocked(gitClient.query).mockResolvedValue([commit]);

    const result = await repo.findById({ id: targetId, protocol: 'alpha' });

    expect(result).not.toBeNull();
    const state = result!.protocols.get('alpha')!;
    expect(state.trailers['Alpha-id'][0]).toBe(targetId);
    
    // Ensure we used a specific regex pattern
    const query = vi.mocked(gitClient.query).mock.calls[0][0];
    const found = query.regexPatterns.some((set: string[]) => 
        set.some(p => p.includes('alpha: Alpha-id: 12345678'))
    );
    expect(found).toBe(true);
  });

  it('should find an atom using a qualified ID (beta/12345678)', async () => {
    const targetId = '12345678';
    const commit: RawCommit = {
      hash: 'h2',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: `beta: Beta-id: ${targetId}`,
      filesChanged: [],
    };

    vi.mocked(gitClient.query).mockResolvedValue([commit]);

    const result = await repo.findById({ id: targetId, protocol: 'beta' });

    expect(result).not.toBeNull();
    expect(result!.protocols.has('beta')).toBe(true);
  });

  it('should resolve ambiguous IDs by checking all protocols (three-pass) when a global protocol exists', async () => {
    // Register a Global protocol (no namespace)
    const LORE_DEF = {
        name: 'Lore',
        version: '1.0',
        identityKey: 'Lore-id',
        namespace: '', // Global
        trailers: {
          'Lore-id': { description: 'ID', multivalue: false, validation: 'pattern' as const, pattern: '^[0-9a-f]{8}$' },
        }
    };
    protocolRegistry.register(makeStubProtocolContext(LORE_DEF));

    const targetId = '12345678';
    // Commit only has Beta ID
    const commit: RawCommit = {
      hash: 'h2',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: `beta: Beta-id: ${targetId}`,
      filesChanged: [],
    };

    vi.mocked(gitClient.query).mockResolvedValue([commit]);

    // Query without protocol prefix
    const result = await repo.findById({ id: targetId });

    expect(result).not.toBeNull();
    expect(result!.protocols.has('beta')).toBe(true);

    // Verification: ensure the query included all possible patterns in an OR-set
    const query = vi.mocked(gitClient.query).mock.calls[0][0];
    expect(query.regexPatterns[0]).toEqual(expect.arrayContaining([
        '^Lore-id: 12345678$',
        '^alpha: Alpha-id: 12345678$',
        '^beta: Beta-id: 12345678$'
    ]));
  });

  it('should throw an error for unqualified queries when no global protocol is registered', async () => {
    const targetId = '12345678';
    await expect(repo.findById({ id: targetId }))
      .rejects.toThrow(/No global protocol is registered/);
  });
});
