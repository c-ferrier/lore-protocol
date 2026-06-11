import { beforeEach,describe, expect, it, vi } from 'vitest';

import { ProtocolMap } from '../../../src/engine/core/models/protocol-map.js';
import { type RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { findAtomById } from '../../../src/engine/shell/orchestrators/discovery.js';
import { makeStubProtocolContext, type ProtocolContext } from '../../../src/engine/testing.js';
import { type MockedGitClient } from '../../mock-types.js';
import { makeMockGitClient, makeMockInfra } from '../engine-test-utils.js';

describe('Discovery Identity Disambiguation', () => {
  let git: MockedGitClient;
  let protocols: ProtocolMap<ProtocolContext>;

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
    git = makeMockGitClient();

    protocols = new ProtocolMap();
    protocols.set('alpha', makeStubProtocolContext(ALPHA_DEF));
    protocols.set('beta', makeStubProtocolContext(BETA_DEF));
  });

  const getInfra = () => makeMockInfra({
      git,
      protocols
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

    git.queryStream.mockImplementation(async function* () { yield* [commit]; });

    const infra = getInfra();
    const result = await findAtomById(infra, { id: targetId, protocol: 'alpha' });

    expect(result).not.toBeNull();
    const state = result!.protocols.get('alpha')!;
    expect(state.trailers['Alpha-id'][0]).toBe(targetId);
    
    // Ensure we used a specific regex pattern
    const query = vi.mocked(git.queryStream).mock.calls[0][0];
    const found = query.regexPatterns!.some((set: readonly string[]) => 
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

    git.queryStream.mockImplementation(async function* () { yield* [commit]; });

    const infra = getInfra();
    const result = await findAtomById(infra, { id: targetId, protocol: 'beta' });

    expect(result).not.toBeNull();
    expect(result!.protocols.has('beta')).toBe(true);
  });

  it('should resolve ambiguous IDs by checking all protocols (three-pass) when a global protocol exists', async () => {
    // Register a Global protocol (no namespace)
    const LORE_DEF = {
        name: 'Lore',
        version: '1.0',
        identityKey: 'Lore-id',
        namespace: '', // Root
        trailers: {
          'Lore-id': { description: 'ID', multivalue: false, validation: 'pattern' as const, pattern: '^[0-9a-f]{8}$' },
        }
    };
    protocols.set('lore', makeStubProtocolContext(LORE_DEF));

    const targetId = 'abcdef00';
    // This commit is in Beta protocol format but has no namespace prefix
    const commit: RawCommit = {
      hash: 'h3',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: `Beta-id: ${targetId}`,
      filesChanged: [],
    };

    git.queryStream.mockImplementation(async function* () { yield* [commit]; });

    const infra = getInfra();
    const result = await findAtomById(infra, { id: targetId });

    expect(result).not.toBeNull();
    expect(result!.protocols.has('beta')).toBe(true);
  });

  it('should throw an error for unqualified queries when no global protocol is registered', async () => {
    const targetId = '12345678';
    const infra = getInfra();
    await expect(findAtomById(infra, { id: targetId }))
      .rejects.toThrow(/No global protocol is registered/);
  });
});
