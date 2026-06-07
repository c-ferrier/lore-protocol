import { beforeEach,describe, expect, it, vi } from 'vitest';

import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { makeStubProtocolContext, makeAtomRepository } from '../../../src/engine/testing.js';
import { makeMockGitClient } from '../engine-test-utils.js';
;
;

;

describe('Multi-Protocol Integration', () => {
  let gitClient: any;
  let repo: any;
  let registry: ProtocolRegistry;

  const FRED_DEF = {
    name: 'Fred',
    version: '1.0',
    namespace: 'fred',
    identityKey: 'Fred-id',
    trailers: { 'Fred-id': { description: 'ID', multivalue: false, validation: 'none' as const } }
  };

  beforeEach(() => {
    gitClient = makeMockGitClient();

    registry = new ProtocolRegistry();
    const mock = makeStubProtocolContext({
        name: 'Mock',
        identityKey: 'Mock-id',
        trailers: { 'Mock-id': { description: 'ID', multivalue: false, validation: 'none' as const } }
    });
    const fred = makeStubProtocolContext(FRED_DEF);
    registry.register(mock);
    registry.register(fred);

    repo = makeAtomRepository({
        gitClient,
        registry,
    });
  });

  it('Discovery: should aggregate discovery patterns from all protocols', async () => {
    await repo.find();
    const query = vi.mocked(gitClient.query).mock.calls[0][0];
    
    // Top-level 0 is the discovery OR-set
    const discoverySet = query.regexPatterns[0];
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

    vi.mocked(gitClient.query).mockResolvedValue([commit]);

    const [atom] = await repo.find();
    
    expect(atom.protocols.has('mock')).toBe(true);
    expect(atom.protocols.has('fred')).toBe(true);

    const mockState = atom.protocols.get('mock')!;
    const fredState = atom.protocols.get('fred')!;

    expect(mockState.trailers['Mock-id']).toEqual(['m1']);
    expect(fredState.trailers['Fred-id']).toEqual(['f1']);
  });

  it('Conflict: should not allow two protocols with same name', () => {
    const p1 = makeStubProtocolContext({ name: 'Dup', trailers: {} });
    const p2 = makeStubProtocolContext({ name: 'Dup', trailers: {} });
    
    const reg = new ProtocolRegistry();
    reg.register(p1);
    expect(() => reg.register(p2)).toThrow(/already registered/);
  });
});