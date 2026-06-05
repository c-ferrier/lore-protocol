import { beforeEach,describe, expect, it } from 'vitest';

import { filterActiveAtoms,resolveSupersession } from '../../../../src/engine/core/logic/supersession.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { makeAtom, makeMockContext } from '../../../../src/engine/testing.js';

describe('Supersession Logic (Pure Functions)', () => {
  let registry: ProtocolRegistry;

  beforeEach(() => {
    registry = new ProtocolRegistry();
  });

  it('should resolve a direct supersession chain', () => {
    const ctx = makeMockContext({ name: 'mock', identityKey: 'Id' });
    registry.register(ctx);

    const a1 = makeAtom({ id: 'id1', trailers: { 'Id': ['id1'] } });
    const a2 = makeAtom({ id: 'id2', trailers: { 'Id': ['id2'], 'Supersedes': ['id1'] } });

    const map = resolveSupersession([a1, a2], registry);
    const status1 = map.get('mock')!.get('id1')!;
    
    expect(status1.superseded).toBe(true);
    expect(status1.supersededBy).toContain('id2');
  });

  it('should handle multiple atoms superseded by one', () => {
    const ctx = makeMockContext({ name: 'mock', identityKey: 'Id' });
    registry.register(ctx);

    const a1 = makeAtom({ id: 'a1', trailers: { 'Id': ['a1'], 'Supersedes': ['b2', 'c3'] } });
    const b2 = makeAtom({ id: 'b2', trailers: { 'Id': ['b2'] } });
    const c3 = makeAtom({ id: 'c3', trailers: { 'Id': ['c3'] } });

    const map = resolveSupersession([a1, b2, c3], registry);
    const result = map.get('mock')!;

    expect(result.get('b2')!.superseded).toBe(true);
    expect(result.get('b2')!.supersededBy).toEqual(['a1']);
    expect(result.get('c3')!.superseded).toBe(true);
    expect(result.get('c3')!.supersededBy).toEqual(['a1']);
  });

  it('should resolve transitive supersession chains', () => {
    const ctx = makeMockContext({ name: 'mock', identityKey: 'Id' });
    registry.register(ctx);

    const a1 = makeAtom({ id: 'id1', trailers: { 'Id': ['id1'] } });
    const a2 = makeAtom({ id: 'id2', trailers: { 'Id': ['id2'], 'Supersedes': ['id1'] } });
    const a3 = makeAtom({ id: 'id3', trailers: { 'Id': ['id3'], 'Supersedes': ['id2'] } });

    const map = resolveSupersession([a1, a2, a3], registry);
    const status1 = map.get('mock')!.get('id1')!;
    
    // a1 is superseded by a2 AND a3 (transitively)
    expect(status1.superseded).toBe(true);
    expect(status1.supersededBy).toContain('id2');
    expect(status1.supersededBy).toContain('id3');
  });

  it('should handle circular references without infinite loop', () => {
    const ctx = makeMockContext({ name: 'mock', identityKey: 'Id' });
    registry.register(ctx);

    const a1 = makeAtom({ id: 'a1', trailers: { 'Id': ['a1'], 'Supersedes': ['b2'] } });
    const b2 = makeAtom({ id: 'b2', trailers: { 'Id': ['b2'], 'Supersedes': ['a1'] } });

    const map = resolveSupersession([a1, b2], registry);
    const result = map.get('mock')!;

    // Both should be marked as superseded since each supersedes the other
    expect(result.get('a1')!.superseded).toBe(true);
    expect(result.get('b2')!.superseded).toBe(true);
  });

  it('should resolve cross-protocol supersession', () => {
    const p1 = makeMockContext({ name: 'Alpha', namespace: 'alpha', identityKey: 'Id' });
    const p2 = makeMockContext({ name: 'Beta', namespace: 'beta', identityKey: 'Id' });
    registry.register(p1);
    registry.register(p2);

    const a1 = makeAtom({ 
        protocols: new Map([['alpha', { trailers: { 'Id': ['a1'] }, unauthorized: {} }]]) 
    });
    const a2 = makeAtom({ 
        protocols: new Map([['beta', { trailers: { 'Id': ['b1'], 'Supersedes': ['alpha/a1'] }, unauthorized: {} }]]) 
    });

    const map = resolveSupersession([a1, a2], registry);
    const statusA1 = map.get('alpha')!.get('a1')!;
    
    expect(statusA1.superseded).toBe(true);
    expect(statusA1.supersededBy).toContain('beta/b1');
  });

  it('should filter active atoms correctly', () => {
      const ctx = makeMockContext({ name: 'mock', identityKey: 'Id' });
      registry.register(ctx);

      const a1 = makeAtom({ id: 'id1', trailers: { 'Id': ['id1'] } });
      const a2 = makeAtom({ id: 'id2', trailers: { 'Id': ['id2'], 'Supersedes': ['id1'] } });
      const atoms = [a1, a2];

      const map = resolveSupersession(atoms, registry);
      const active = filterActiveAtoms(atoms, map, registry);

      expect(active).toHaveLength(1);
      expect(active[0].commitHash).toBe(a2.commitHash);
  });
});
