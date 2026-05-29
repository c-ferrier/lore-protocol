import { describe, it, expect, beforeEach } from 'vitest';
import { SupersessionResolver } from '../../../../src/engine/services/supersession-resolver.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG, makeProtocol } from '../test-utils.js';
import type { Atom, Trailers } from '../../../../src/engine/types/domain.js';

const MOCK_ID_KEY = "Mock-id";
const LORE_ID_KEY = "Lore-id";

const LORE_DEFINITION = {
    ...MOCK_PROTOCOL_DEFINITION,
    name: 'Lore',
    identityKey: LORE_ID_KEY,
};

function makeAtom(options: {
  id: string;
  protocol?: string;
  supersedes?: string[];
}): Atom {
  const pName = options.protocol ?? 'mock';
  const idKey = pName === 'mock' ? MOCK_ID_KEY : LORE_ID_KEY;
  
  const trailers: Trailers = {
    [idKey]: [options.id],
    Supersedes: options.supersedes ?? [],
  } as any;

  return {
    commitHash: `hash-${pName}-${options.id}`,
    date: new Date('2025-01-15T10:00:00Z'),
    author: 'dev@example.com',
    subject: 'test commit',
    body: '',
    protocols: new Map([
      [pName, { name: pName.charAt(0).toUpperCase() + pName.slice(1), version: '1.0', identityKey: idKey, trailers }]
    ]),
    filesChanged: [],
  };
}

describe('SupersessionResolver Cross-Protocol', () => {
  let resolver: SupersessionResolver;
  let registry: ProtocolRegistry;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    // Use different namespaces to avoid root permissive conflict
    registry.register(makeProtocol({ ...MOCK_PROTOCOL_DEFINITION, namespace: 'mock' }));
    registry.register(makeProtocol({ ...LORE_DEFINITION, namespace: 'lore' }));
    resolver = new SupersessionResolver(registry);
  });

  it('should resolve supersession across protocols (Lore supersedes Mock)', () => {
    const atoms = [
      makeAtom({ id: 'aaaa1111', protocol: 'lore', supersedes: ['mock/bbbb2222'] }),
      makeAtom({ id: 'bbbb2222', protocol: 'mock' }),
    ];

    const globalResult = resolver.resolveAll(atoms);
    
    // Check Mock status
    const mockStatus = globalResult.get('mock')!;
    expect(mockStatus.get('bbbb2222')?.superseded).toBe(true);
    expect(mockStatus.get('bbbb2222')?.supersededBy).toBe('lore/aaaa1111');
    
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

    const globalResult = resolver.resolveAll(atoms);
    
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

    const globalResult = resolver.resolveAll(atoms);
    
    expect(globalResult.get('lore')?.get('deadbeef')?.superseded).toBe(true);
    expect(globalResult.get('lore')?.get('deadbeef')?.supersededBy).toBe('12345678');
    
    expect(globalResult.get('lore')?.get('12345678')?.superseded).toBe(false);
    expect(globalResult.get('mock')?.get('12345678')?.superseded).toBe(false);
  });

  it('should be robust against unresolvable references in supersession chain', () => {
    const atoms = [
      makeAtom({ id: 'aaaa1111', protocol: 'lore', supersedes: ['nonexistent/123', 'mock/bbbb2222'] }),
      makeAtom({ id: 'bbbb2222', protocol: 'mock' }),
    ];

    const globalResult = resolver.resolveAll(atoms);
    
    // Should still resolve the valid part of the chain
    expect(globalResult.get('mock')?.get('bbbb2222')?.superseded).toBe(true);
    expect(globalResult.get('mock')?.get('bbbb2222')?.supersededBy).toBe('lore/aaaa1111');
  });
});
