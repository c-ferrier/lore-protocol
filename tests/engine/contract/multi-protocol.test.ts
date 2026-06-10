import { beforeEach,describe, expect, it, vi } from 'vitest';

import { ProtocolMap } from '../../../src/engine/core/models/protocol-map.js';
import { findAtoms } from '../../../src/engine/shell/orchestrators/discovery.js';
import { makeStubProtocolContext, type ProtocolContext } from '../../../src/engine/testing.js';
import { type MockedGitClient } from '../../mock-types.js';
import { makeMockGitClient, makeMockInfra } from '../engine-test-utils.js';

describe('Multi-Protocol Integration', () => {
  let git: MockedGitClient;
  let protocols: ProtocolMap<ProtocolContext>;

  const FRED_DEF = {
    name: 'Fred',
    version: '1.0',
    namespace: 'fred',
    identityKey: 'Fred-id',
    trailers: { 'Fred-id': { description: 'ID', multivalue: false, validation: 'none' as const } }
  };

  beforeEach(() => {
    git = makeMockGitClient();

    protocols = new ProtocolMap();
    const mock = makeStubProtocolContext({
        name: 'Mock',
        identityKey: 'Mock-id',
        trailers: { 'Mock-id': { description: 'ID', multivalue: false, validation: 'none' as const } }
    });
    const fred = makeStubProtocolContext(FRED_DEF);
    protocols.set(mock.name, mock);
    protocols.set(fred.name, fred);
  });

  const getInfra = () => makeMockInfra({
      git,
      protocols
  });

  it('Discovery: should aggregate discovery patterns from all protocols', async () => {
    const infra = getInfra();
    await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] });
    const query = vi.mocked(git.query).mock.calls[0][0];
    
    // Top-level 0 is the discovery OR-set
    const discoverySet = query.regexPatterns![0];
    expect(discoverySet).toContain('^Mock-id: ');
    expect(discoverySet).toContain('^fred:');
  });

  it('Ownership: should respect namespaced trailers', async () => {
    const commit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: 'b',
      trailers: 'Mock-id: m1\nfred: Fred-id: f1',
      filesChanged: [],
    };

    vi.mocked(git.query).mockResolvedValue([commit]);

    const infra = getInfra();
    const [atom] = await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] });
    
    expect(atom.protocols.has('mock')).toBe(true);
    expect(atom.protocols.has('fred')).toBe(true);

    const mockState = atom.protocols.get('mock')!;
    const fredState = atom.protocols.get('fred')!;

    expect(mockState.trailers['Mock-id']).toEqual(['m1']);
    expect(fredState.trailers['Fred-id']).toEqual(['f1']);
  });
});