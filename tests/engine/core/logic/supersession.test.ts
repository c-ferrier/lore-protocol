import { beforeEach,describe, expect, it } from 'vitest';

import { filterActiveAtoms,resolveSupersession } from '../../../../src/engine/core/logic/supersession.js';
import { ProtocolMap } from '../../../../src/engine/core/models/protocol-map.js';
import { makeAtom, makeStubProtocolContext, makeStubProtocolMap, makeStubProtocolState, type ProtocolContext } from '../../../../src/engine/testing.js';

describe('Supersession Logic (Pure Functions)', () => {
  let protocols: ProtocolMap<ProtocolContext>;

  beforeEach(() => {
    protocols = makeStubProtocolMap();
  });

  it('should resolve a direct supersession chain', () => {
    const ctx = makeStubProtocolContext({ name: 'mock', identityKey: 'Id' });
    protocols.set(ctx.name, ctx);

    const a1 = makeAtom({ id: 'id1', trailers: { 'Id': ['id1'] } });
    const a2 = makeAtom({ id: 'id2', trailers: { 'Id': ['id2'], 'Supersedes': ['id1'] } });

    const map = resolveSupersession([a1, a2], protocols);
    const status1 = map.get('mock')!.get('id1')!;
    
    expect(status1.superseded).toBe(true);
    expect(status1.supersededBy).toContain('id2');
  });

  it('should handle multiple atoms superseded by one', () => {
    const ctx = makeStubProtocolContext({ name: 'mock', identityKey: 'Id' });
    protocols.set(ctx.name, ctx);

    const a1 = makeAtom({ id: 'a1', trailers: { 'Id': ['a1'], 'Supersedes': ['b2', 'c3'] } });
    const b2 = makeAtom({ id: 'b2', trailers: { 'Id': ['b2'] } });
    const c3 = makeAtom({ id: 'c3', trailers: { 'Id': ['c3'] } });

    const map = resolveSupersession([a1, b2, c3], protocols);
    const result = map.get('mock')!;

    expect(result.get('b2')!.superseded).toBe(true);
    expect(result.get('b2')!.supersededBy).toEqual(['a1']);
    expect(result.get('c3')!.superseded).toBe(true);
    expect(result.get('c3')!.supersededBy).toEqual(['a1']);
  });

  it('should resolve transitive supersession chains', () => {
    const ctx = makeStubProtocolContext({ name: 'mock', identityKey: 'Id' });
    protocols.set(ctx.name, ctx);

    const a1 = makeAtom({ id: 'id1', trailers: { 'Id': ['id1'] } });
    const a2 = makeAtom({ id: 'id2', trailers: { 'Id': ['id2'], 'Supersedes': ['id1'] } });
    const a3 = makeAtom({ id: 'id3', trailers: { 'Id': ['id3'], 'Supersedes': ['id2'] } });

    const map = resolveSupersession([a1, a2, a3], protocols);
    const status1 = map.get('mock')!.get('id1')!;
    
    // a1 is superseded by a2 AND a3 (transitively)
    expect(status1.superseded).toBe(true);
    expect(status1.supersededBy).toContain('id2');
    expect(status1.supersededBy).toContain('id3');
  });

  it('should handle circular references without infinite loop', () => {
    const ctx = makeStubProtocolContext({ name: 'mock', identityKey: 'Id' });
    protocols.set(ctx.name, ctx);

    const a1 = makeAtom({ id: 'a1', trailers: { 'Id': ['a1'], 'Supersedes': ['b2'] } });
    const b2 = makeAtom({ id: 'b2', trailers: { 'Id': ['b2'], 'Supersedes': ['a1'] } });

    const map = resolveSupersession([a1, b2], protocols);
    const result = map.get('mock')!;

    // Both should be marked as superseded since each supersedes the other
    expect(result.get('a1')!.superseded).toBe(true);
    expect(result.get('b2')!.superseded).toBe(true);
  });

  it('should resolve cross-protocol supersession', () => {
    const p1 = makeStubProtocolContext({ name: 'Alpha', namespace: 'alpha', identityKey: 'Id' });
    const p2 = makeStubProtocolContext({ name: 'Beta', namespace: 'beta', identityKey: 'Id' });
    protocols.set(p1.name, p1);
    protocols.set(p2.name, p2);

    const a1 = makeAtom({ 
        protocols: makeStubProtocolMap([['alpha', makeStubProtocolState({ trailers: { 'Id': ['a1'] } })]]) 
    });
    const a2 = makeAtom({ 
        protocols: makeStubProtocolMap([['beta', makeStubProtocolState({ trailers: { 'Id': ['b1'], 'Supersedes': ['alpha/a1'] } })]]) 
    });

    const map = resolveSupersession([a1, a2], protocols);
    const statusA1 = map.get('alpha')!.get('a1')!;
    
    expect(statusA1.superseded).toBe(true);
    expect(statusA1.supersededBy).toContain('beta/b1');
  });

  it('should filter active atoms correctly', () => {
      const ctx = makeStubProtocolContext({ name: 'mock', identityKey: 'Id' });
      protocols.set(ctx.name, ctx);

      const a1 = makeAtom({ id: 'id1', trailers: { 'Id': ['id1'] } });
      const a2 = makeAtom({ id: 'id2', trailers: { 'Id': ['id2'], 'Supersedes': ['id1'] } });
      const atoms = [a1, a2];

      const map = resolveSupersession(atoms, protocols);
      const active = filterActiveAtoms(atoms, map, protocols);

      expect(active).toHaveLength(1);
      expect(active[0].commitHash).toBe(a2.commitHash);
  });
});