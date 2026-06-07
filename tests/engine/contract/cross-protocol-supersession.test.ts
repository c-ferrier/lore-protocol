import { beforeEach,describe, expect, it } from 'vitest';

import { resolveSupersession } from '../../../src/engine/core/logic/supersession.js';
import { type Atom } from '../../../src/engine/core/types/domain.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { makeStubProtocolContext,TEST_PROTOCOL_DEFINITION } from '../../../src/engine/testing.js';
;
;
;

;


const TEST_ID_KEY = "Mock-id";
const LORE_ID_KEY = "Lore-id";

const LORE_DEFINITION = {
    ...TEST_PROTOCOL_DEFINITION,
    name: 'Lore',
    identityKey: LORE_ID_KEY,
};

function makeAtom(options: {
  id: string;
  protocol?: string;
  supersedes?: string[];
}): Atom {
  const pName = (options.protocol ?? 'mock').toLowerCase();
  const idKey = pName === 'mock' ? TEST_ID_KEY : LORE_ID_KEY;
  
  const trailers: Record<string, string[]> = {
    [idKey]: [options.id],
    Supersedes: options.supersedes ?? [],
  };

  return {
    commitHash: `hash-${pName}-${options.id}`,
    date: new Date('2025-01-15T10:00:00Z'),
    author: 'dev@example.com',
    subject: 'test commit',
    body: '',
    rawTrailers: '',
    protocols: new Map([
      [pName, { trailers, unauthorized: {} }]
    ]),
    filesChanged: [],
  };
}

describe('Supersession Logic Cross-Protocol', () => {
  let registry: ProtocolRegistry;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    // Use different namespaces to avoid root permissive conflict
    registry.register(makeStubProtocolContext({ ...TEST_PROTOCOL_DEFINITION, namespace: 'mock' }));
    registry.register(makeStubProtocolContext({ ...LORE_DEFINITION, namespace: 'lore' }));
  });

  it('should resolve supersession across protocols (Lore supersedes Mock)', () => {
    const atoms = [
      makeAtom({ id: 'aaaa1111', protocol: 'lore', supersedes: ['mock/bbbb2222'] }),
      makeAtom({ id: 'bbbb2222', protocol: 'mock' }),
    ];

    const globalResult = resolveSupersession(atoms, registry);
    
    // Check Mock status
    const mockStatus = globalResult.get('mock')!;
    expect(mockStatus.get('bbbb2222')?.superseded).toBe(true);
    expect(mockStatus.get('bbbb2222')?.supersededBy).toEqual(['lore/aaaa1111']);
    
    // Check Lore status
    const loreStatus = globalResult.get('lore')!;
    expect(loreStatus.get('aaaa1111')?.superseded).toBe(false);
  });

  it('should handle transitive cross-protocol chains', () => {
    const atoms = [
      makeAtom({ id: 'aaaa1111', protocol: 'lore', supersedes: ['mock/bbbb2222'] }),
      makeAtom({ id: 'bbbb2222', protocol: 'mock', supersedes: ['lore/cccc3333'] }),
      makeAtom({ id: 'cccc3333', protocol: 'lore' }),
    ];

    const globalResult = resolveSupersession(atoms, registry);
    
    expect(globalResult.get('mock')?.get('bbbb2222')?.superseded).toBe(true);
    expect(globalResult.get('lore')?.get('cccc3333')?.superseded).toBe(true);
    expect(globalResult.get('lore')?.get('aaaa1111')?.superseded).toBe(false);
  });

  it('should prevent collision when same ID exists in different protocols', () => {
    const atoms = [
      makeAtom({ id: '12345678', protocol: 'lore', supersedes: ['lore/deadbeef'] }),
      makeAtom({ id: '12345678', protocol: 'mock' }),
      makeAtom({ id: 'deadbeef', protocol: 'lore' }),
    ];

    const globalResult = resolveSupersession(atoms, registry);
    
    expect(globalResult.get('lore')?.get('deadbeef')?.superseded).toBe(true);
    expect(globalResult.get('lore')?.get('deadbeef')?.supersededBy).toEqual(['12345678']);
    
    expect(globalResult.get('lore')?.get('12345678')?.superseded).toBe(false);
    expect(globalResult.get('mock')?.get('12345678')?.superseded).toBe(false);
  });

  it('should be robust against unresolvable references in supersession chain', () => {
    const atoms = [
      makeAtom({ id: 'aaaa1111', protocol: 'lore', supersedes: ['nonexistent/123', 'mock/bbbb2222'] }),
      makeAtom({ id: 'bbbb2222', protocol: 'mock' }),
    ];

    const globalResult = resolveSupersession(atoms, registry);
    
    // Should still resolve the valid part of the chain
    expect(globalResult.get('mock')?.get('bbbb2222')?.superseded).toBe(true);
    expect(globalResult.get('mock')?.get('bbbb2222')?.supersededBy).toEqual(['lore/aaaa1111']);
  });
});