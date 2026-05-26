import { describe, it, expect, beforeEach } from 'vitest';
import { SupersessionResolver } from '../../../../src/engine/services/supersession-resolver.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG } from '../test-utils.js';
import type { Atom, Trailers } from '../../../../src/engine/types/domain.js';

const MOCK_ID_KEY = "Mock-id";

function makeAtom(options: {
  id: string;
  supersedes?: string[];
  dependsOn?: string[];
  related?: string[];
}): Atom {
  const trailers: Trailers = {
    [MOCK_ID_KEY]: [options.id],
    Constraint: [],
    Confidence: [],
    Related: options.related ?? [],
    Supersedes: options.supersedes ?? [],
  } as any;

  return {
    commitHash: `hash-${options.id}`,
    date: new Date('2025-01-15T10:00:00Z'),
    author: 'dev@example.com',
    subject: 'test commit',
    body: '',
    protocols: new Map([
      ['mock', { name: 'Mock', version: '1.0', identityKey: MOCK_ID_KEY, trailers }]
    ]),
    filesChanged: [],
  };
}


describe('SupersessionResolver', () => {
  let resolver: SupersessionResolver;
  let protocol: Protocol;
  let registry: ProtocolRegistry;

  beforeEach(() => {
    protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG);
    registry = new ProtocolRegistry();
    registry.register(protocol);
    resolver = new SupersessionResolver(registry);
  });

  describe('resolveAll', () => {
    it('should return all atoms as active when no supersession exists', () => {
      const atoms = [
        makeAtom({ id: 'aaaa1111' }),
        makeAtom({ id: 'bbbb2222' }),
        makeAtom({ id: 'cccc3333' }),
      ];

      const globalResult = resolver.resolveAll(atoms);
      const result = globalResult.get('mock')!;

      expect(result.size).toBe(3);
      for (const [, status] of result) {
        expect(status.superseded).toBe(false);
        expect(status.supersededBy).toBeNull();
      }
    });

    it('should mark a directly superseded atom', () => {
      const atoms = [
        makeAtom({ id: 'aaaa1111', supersedes: ['bbbb2222'] }),
        makeAtom({ id: 'bbbb2222' }),
      ];

      const globalResult = resolver.resolveAll(atoms);
      const result = globalResult.get('mock')!;

      expect(result.get('aaaa1111')!.superseded).toBe(false);
      expect(result.get('bbbb2222')!.superseded).toBe(true);
      expect(result.get('bbbb2222')!.supersededBy).toBe('aaaa1111');
    });

    it('should handle multiple atoms superseded by one', () => {
      const atoms = [
        makeAtom({ id: 'aaaa1111', supersedes: ['bbbb2222', 'cccc3333'] }),
        makeAtom({ id: 'bbbb2222' }),
        makeAtom({ id: 'cccc3333' }),
      ];

      const globalResult = resolver.resolveAll(atoms);
      const result = globalResult.get('mock')!;

      expect(result.get('aaaa1111')!.superseded).toBe(false);
      expect(result.get('bbbb2222')!.superseded).toBe(true);
      expect(result.get('bbbb2222')!.supersededBy).toBe('aaaa1111');
      expect(result.get('cccc3333')!.superseded).toBe(true);
      expect(result.get('cccc3333')!.supersededBy).toBe('aaaa1111');
    });

    it('should handle transitive chains: A supersedes B, B supersedes C', () => {
      const atoms = [
        makeAtom({ id: 'aaaa1111', supersedes: ['bbbb2222'] }),
        makeAtom({ id: 'bbbb2222', supersedes: ['cccc3333'] }),
        makeAtom({ id: 'cccc3333' }),
      ];

      const globalResult = resolver.resolveAll(atoms);
      const result = globalResult.get('mock')!;

      expect(result.get('aaaa1111')!.superseded).toBe(false);
      expect(result.get('bbbb2222')!.superseded).toBe(true);
      expect(result.get('cccc3333')!.superseded).toBe(true);
    });

    it('should handle circular references without infinite loop', () => {
      const atoms = [
        makeAtom({ id: 'aaaa1111', supersedes: ['bbbb2222'] }),
        makeAtom({ id: 'bbbb2222', supersedes: ['aaaa1111'] }),
      ];

      const globalResult = resolver.resolveAll(atoms);
      const result = globalResult.get('mock')!;

      // Both should be marked as superseded since each supersedes the other
      expect(result.get('aaaa1111')!.superseded).toBe(true);
      expect(result.get('bbbb2222')!.superseded).toBe(true);
    });

    it('should handle empty atom list', () => {
      const globalResult = resolver.resolveAll([]);
      const result = globalResult.get('mock')!;

      expect(result.size).toBe(0);
    });

    it('should handle single atom with no supersession', () => {
      const atoms = [makeAtom({ id: 'aaaa1111' })];

      const globalResult = resolver.resolveAll(atoms);
      const result = globalResult.get('mock')!;

      expect(result.size).toBe(1);
      expect(result.get('aaaa1111')!.superseded).toBe(false);
    });

    it('should handle atoms with missing trailers without throwing', () => {
      const sparseAtom: any = {
        date: new Date(),
        protocols: new Map([
          ['mock', { name: 'Mock', version: '1.0', identityKey: MOCK_ID_KEY, trailers: { [MOCK_ID_KEY]: ['sparse123'] } }]
        ]),
      };

      const globalResult = resolver.resolveAll([sparseAtom]);
      const result = globalResult.get('mock')!;
      expect(result.get('sparse123')!.superseded).toBe(false);
    });

    it(`should skip invalid identity references`, () => {
      const atoms = [
        makeAtom({ id: 'aaaa1111', supersedes: ['not-valid', 'bbbb2222'] }),
        makeAtom({ id: 'bbbb2222' }),
      ];

      const globalResult = resolver.resolveAll(atoms);
      const result = globalResult.get('mock')!;

      expect(result.get('bbbb2222')!.superseded).toBe(true);
      expect(result.get('aaaa1111')!.superseded).toBe(false);
    });
  });

  describe('filterActive', () => {
    it('should return only active (non-superseded) atoms', () => {
      const atoms = [
        makeAtom({ id: 'aaaa1111', supersedes: ['bbbb2222'] }),
        makeAtom({ id: 'bbbb2222' }),
        makeAtom({ id: 'cccc3333' }),
      ];

      const globalSupersessionMap = resolver.resolveAll(atoms);
      const active = resolver.filterActive(atoms, globalSupersessionMap);

      expect(active).toHaveLength(2);
      const activeHashes = active.map((a) => a.commitHash);
      expect(activeHashes).toContain('hash-aaaa1111');
      expect(activeHashes).toContain('hash-cccc3333');
      expect(activeHashes).not.toContain('hash-bbbb2222');
    });

    it('should return all atoms when none are superseded', () => {
      const atoms = [
        makeAtom({ id: 'aaaa1111' }),
        makeAtom({ id: 'bbbb2222' }),
      ];

      const globalSupersessionMap = resolver.resolveAll(atoms);
      const active = resolver.filterActive(atoms, globalSupersessionMap);

      expect(active).toHaveLength(2);
    });

    it('should return empty array when all atoms are superseded', () => {
      const atoms = [
        makeAtom({ id: 'aaaa1111', supersedes: ['bbbb2222'] }),
        makeAtom({ id: 'bbbb2222', supersedes: ['aaaa1111'] }),
      ];

      const globalSupersessionMap = resolver.resolveAll(atoms);
      const active = resolver.filterActive(atoms, globalSupersessionMap);

      expect(active).toHaveLength(0);
    });
  });
});
