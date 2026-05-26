import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SquashMerger } from '../../../../src/engine/services/squash-merger.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { LoreProtocolDefinition } from '../../../../src/lore/protocol-definition.js';
import { LORE_DEFAULT_CONFIG } from '../../../../src/lore/defaults.js';

import type { Atom, Trailers, AtomId } from '../../../../src/engine/types/domain.js';

const LORE_ID_KEY = "Lore-id";

function createMockIdGenerator(id = 'deadbeef') {
  return {
    generate: vi.fn(() => id),
  };
}

function makeTrailers(overrides: Partial<Trailers> = {}): Trailers {
  return {
    [LORE_ID_KEY]: overrides[LORE_ID_KEY] ?? ['a1b2c3d4'],
    Constraint: overrides.Constraint ?? [],
    Rejected: overrides.Rejected ?? [],
    Confidence: overrides.Confidence ?? [],
    'Scope-risk': overrides['Scope-risk'] ?? [],
    Reversibility: overrides.Reversibility ?? [],
    Directive: overrides.Directive ?? [],
    Tested: overrides.Tested ?? [],
    'Not-tested': overrides['Not-tested'] ?? [],
    Supersedes: overrides.Supersedes ?? [],
    'Depends-on': overrides['Depends-on'] ?? [],
    Related: overrides.Related ?? [],
    ...overrides,
  } as any;
}

function makeAtom(overrides: Partial<any> = {}): Atom {
  const trailerOverrides = { ...overrides };
  delete trailerOverrides.commitHash;
  delete trailerOverrides.date;
  delete trailerOverrides.author;
  delete trailerOverrides.subject;
  delete trailerOverrides.body;
  delete trailerOverrides.filesChanged;
  delete trailerOverrides.protocols;
  delete trailerOverrides.trailers;

  const trailers = overrides.trailers ?? makeTrailers(trailerOverrides);
  return {
    commitHash: overrides.commitHash ?? 'abc1234567890',
    date: overrides.date ?? new Date('2025-01-15T10:00:00Z'),
    author: overrides.author ?? 'alice@example.com',
    subject: overrides.subject ?? overrides.intent ?? 'feat(auth): add login flow',
    body: overrides.body ?? '',
    protocols: new Map([
      ['lore', {
        name: 'Lore',
        version: '1.0',
        identityKey: LORE_ID_KEY,
        trailers
      }]
    ]),
    filesChanged: overrides.filesChanged ?? ['src/auth.ts'],
  } as any;
}

describe('SquashMerger', () => {
  let merger: SquashMerger;
  let mockIdGen: ReturnType<typeof createMockIdGenerator>;
  let protocol: Protocol;
  let registry: ProtocolRegistry;

  beforeEach(() => {
    mockIdGen = createMockIdGenerator();
    protocol = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);
    registry = new ProtocolRegistry();
    registry.register(protocol);
    merger = new SquashMerger(mockIdGen as any, registry);
  });

  it('should throw for empty atoms', () => {
    expect(() => merger.merge([], {})).toThrow('Cannot merge zero atoms');
  });

  it(`should generate a new ${LORE_ID_KEY}`, () => {
    const atom = makeAtom();
    const { message, protocols } = merger.merge([atom], {});

    expect(mockIdGen.generate).toHaveBeenCalledOnce();
    expect(message).toContain(`${LORE_ID_KEY}: deadbeef`);
    expect(protocols.lore.id).toBe('deadbeef');
  });

  describe('intent merging', () => {
    it('should use options.subject when provided', () => {
      const atom = makeAtom({ subject: 'old intent' });
      const { message } = merger.merge([atom], { subject: 'new intent' });

      expect(message.startsWith('new intent')).toBe(true);
    });

    it('should use newest atom intent when no option provided', () => {
      const older = makeAtom({
        id: 'aaaa0001',
        date: new Date('2025-01-01'),
        subject: 'older intent',
      });
      const newer = makeAtom({
        id: 'aaaa0002',
        date: new Date('2025-06-01'),
        subject: 'newer intent',
      });

      const { message } = merger.merge([older, newer], {});

      expect(message.startsWith('newer intent')).toBe(true);
    });
  });

  describe('body merging', () => {
    it('should use options.body when provided', () => {
      const atom = makeAtom({ body: 'original body' });
      const { message } = merger.merge([atom], { body: 'override body' });

      expect(message).toContain('override body');
      expect(message).not.toContain('original body');
    });

    it('should concatenate body summaries from all atoms', () => {
      const a1 = makeAtom({ id: 'aaaa0001', body: 'First body', date: new Date('2025-01-01') });
      const a2 = makeAtom({ id: 'aaaa0002', body: 'Second body', date: new Date('2025-02-01') });

      const { message } = merger.merge([a1, a2], {});

      expect(message).toContain('First body');
      expect(message).toContain('Second body');
    });

    it('should skip empty bodies', () => {
      const a1 = makeAtom({ id: 'aaaa0001', body: '', date: new Date('2025-01-01') });
      const a2 = makeAtom({ id: 'aaaa0002', body: 'Has body', date: new Date('2025-02-01') });

      const { message } = merger.merge([a1, a2], {});

      expect(message).toContain('Has body');
    });
  });

  describe('array trailer merging', () => {
    it('should union and deduplicate array trailers', () => {
      const a1 = makeAtom({
        id: 'aaaa0001',
        trailers: makeTrailers({
          [LORE_ID_KEY]: ['aaaa0001'],
          Constraint: ['Must use HTTPS', 'No external deps'],
          Tested: ['Unit tests'],
        }),
      });
      const a2 = makeAtom({
        id: 'aaaa0002',
        trailers: makeTrailers({
          [LORE_ID_KEY]: ['aaaa0002'],
          Constraint: ['Must use HTTPS', 'Max 100ms latency'],
          Tested: ['Integration tests'],
        }),
      });

      const { message } = merger.merge([a1, a2], {});

      expect(message).toContain('Constraint: Must use HTTPS');
      expect(message).toContain('Constraint: No external deps');
      expect(message).toContain('Constraint: Max 100ms latency');
      const matches = message.match(/Constraint: Must use HTTPS/g);
      expect(matches).toHaveLength(1);
    });
  });

  describe('enum trailer merging', () => {
    it('should pick lowest confidence (most conservative)', () => {
      const a1 = makeAtom({
        id: 'aaaa0001',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], Confidence: ['high'] }),
      });
      const a2 = makeAtom({
        id: 'aaaa0002',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0002'], Confidence: ['low'] }),
      });

      const { message } = merger.merge([a1, a2], {});
      expect(message).toContain('Confidence: low');
    });

    it('should pick widest scope-risk', () => {
      const a1 = makeAtom({
        id: 'aaaa0001',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], 'Scope-risk': ['narrow'] }),
      });
      const a2 = makeAtom({
        id: 'aaaa0002',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0002'], 'Scope-risk': ['wide'] }),
      });

      const { message } = merger.merge([a1, a2], {});
      expect(message).toContain('Scope-risk: wide');
    });

    it('should pick least reversible', () => {
      const a1 = makeAtom({
        id: 'aaaa0001',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], Reversibility: ['clean'] }),
      });
      const a2 = makeAtom({
        id: 'aaaa0002',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0002'], Reversibility: ['irreversible'] }),
      });

      const { message } = merger.merge([a1, a2], {});
      expect(message).toContain('Reversibility: irreversible');
    });

    it('should handle null enum values gracefully', () => {
      const a1 = makeAtom({
        id: 'aaaa0001',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], Confidence: ['medium'] }),
      });
      const a2 = makeAtom({
        id: 'aaaa0002',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0002'], Confidence: [] }),
      });

      const { message } = merger.merge([a1, a2], {});
      expect(message).toContain('Confidence: medium');
    });

    it('should pick medium over high for confidence', () => {
      const a1 = makeAtom({
        id: 'aaaa0001',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], Confidence: ['high'] }),
      });
      const a2 = makeAtom({
        id: 'aaaa0002',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0002'], Confidence: ['medium'] }),
      });

      const { message } = merger.merge([a1, a2], {});
      expect(message).toContain('Confidence: medium');
    });

    it('should pick moderate over narrow for scope-risk', () => {
      const a1 = makeAtom({
        id: 'aaaa0001',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], 'Scope-risk': ['narrow'] }),
      });
      const a2 = makeAtom({
        id: 'aaaa0002',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0002'], 'Scope-risk': ['moderate'] }),
      });

      const { message } = merger.merge([a1, a2], {});
      expect(message).toContain('Scope-risk: moderate');
    });

    it('should pick migration-needed over clean for reversibility', () => {
      const a1 = makeAtom({
        id: 'aaaa0001',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], Reversibility: ['clean'] }),
      });
      const a2 = makeAtom({
        id: 'aaaa0002',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0002'], Reversibility: ['migration-needed'] }),
      });

      const { message } = merger.merge([a1, a2], {});
      expect(message).toContain('Reversibility: migration-needed');
    });
  });

  describe('reference trailer merging', () => {
    it('should drop internal references (lore-ids within merged set)', () => {
      const a1 = makeAtom({
        id: 'aaaa0001',
        trailers: makeTrailers({
          [LORE_ID_KEY]: ['aaaa0001'],
          Related: ['aaaa0002'],
        }),
      });
      const a2 = makeAtom({
        id: 'aaaa0002',
        trailers: makeTrailers({
          [LORE_ID_KEY]: ['aaaa0002'],
          'Depends-on': ['aaaa0001'],
        }),
      });

      const { message } = merger.merge([a1, a2], {});
      expect(message).not.toContain('Related: aaaaa0002');
      expect(message).not.toContain('Depends-on: aaaaa0001');
    });

    it('should merge and preserve custom trailers', () => {
      const a1 = makeAtom({
        id: 'aaaa0001',
        trailers: makeTrailers({
          [LORE_ID_KEY]: ['aaaa0001'],
          Team: ['platform'],
        } as any),
      });
      const a2 = makeAtom({
        id: 'aaaa0002',
        trailers: makeTrailers({
          [LORE_ID_KEY]: ['aaaa0002'],
          Team: ['core'],
          Ticket: ['PROJ-123'],
        } as any),
      });

      const { message } = merger.merge([a1, a2], {});
      expect(message).toContain('Team: platform');
      expect(message).toContain('Team: core');
      expect(message).toContain('Ticket: PROJ-123');
    });

    describe('squash strategies', () => {
      it('should respect rank-min (Confidence: low < high)', () => {
        const a1 = makeAtom({ trailers: makeTrailers({ Confidence: ['high'] }) });
        const a2 = makeAtom({ trailers: makeTrailers({ Confidence: ['low'] }) });
        const { message } = merger.merge([a1, a2], {});
        expect(message).toContain('Confidence: low');
      });

      it('should respect rank-max (Scope-risk: wide > narrow)', () => {
        const a1 = makeAtom({ trailers: makeTrailers({ 'Scope-risk': ['narrow'] }) });
        const a2 = makeAtom({ trailers: makeTrailers({ 'Scope-risk': ['wide'] }) });
        const { message } = merger.merge([a1, a2], {});
        expect(message).toContain('Scope-risk: wide');
      });

      it('should support rank-max for custom enums', () => {
        const configWithCustom = {
          ...LORE_DEFAULT_CONFIG,
          trailers: {
            ...LORE_DEFAULT_CONFIG.trailers,
            definitions: {
              Priority: {
                description: 'Prio',
                multivalue: false,
                validation: 'values' as const,
                values: { low: {}, high: {}, urgent: {} },
                squash: 'rank-max' as const,
              }
            },
            custom: [],
            permissive: true,
          }
        };
        const customRegistry = new ProtocolRegistry();
        const customProtocol = new Protocol(LoreProtocolDefinition, configWithCustom);
        customRegistry.register(customProtocol);
        const customMerger = new SquashMerger(mockIdGen as any, customRegistry);

        const a1 = makeAtom({ trailers: makeTrailers({ Priority: ['low'] } as any) });
        const a2 = makeAtom({ trailers: makeTrailers({ Priority: ['urgent'] } as any) });
        
        const { message } = customMerger.merge([a1, a2], {});
        expect(message).toContain('Priority: urgent');
      });
    });
  });

  describe('single atom merge', () => {
    it('should work with a single atom', () => {
      const atom = makeAtom({
        intent: 'single atom intent',
        trailers: makeTrailers({
          [LORE_ID_KEY]: ['a1b2c3d4'],
          Constraint: ['Some constraint'],
          Confidence: ['high'],
        }),
      });

      const { message, protocols } = merger.merge([atom], {});

      expect(message).toContain('single atom intent');
      expect(message).toContain(`${LORE_ID_KEY}: deadbeef`);
      expect(message).toContain('Constraint: Some constraint');
      expect(message).toContain('Confidence: high');
      expect(protocols.lore.id).toBe('deadbeef');
    });
  });


  describe('message structure', () => {
    it('should have proper structure: intent, blank line, body, blank line, trailers', () => {
      const atom = makeAtom({
        id: 'aaaa0001',
        body: 'Atom body text',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], Confidence: ['high'] }),
      });

      const { message } = merger.merge([atom], { subject: 'Merged intent' });
      const lines = message.split('\n');

      expect(lines[0]).toBe('Merged intent');
      expect(lines[1]).toBe('');
      expect(lines[2]).toBe('Atom body text');
      expect(lines[3]).toBe('');
      expect(lines[4]).toContain(`${LORE_ID_KEY}: deadbeef`);
    });
  });

  describe('Multi-Protocol Merging', () => {
    it('should synthesize context for multiple registered protocols simultaneously', () => {
      // 1. Lore protocol (standard)
      // Already setup in beforeEach

      // 2. Setup Fred protocol (Strict, namespaced)
      const fredDef: any = {
        name: 'Fred',
        version: '1.0',
        namespace: 'fred',
        identityKey: 'Fred-id',
        trailers: {
          'Fred-id': { description: 'ID' },
          'Fred-Level': { description: 'Level' },
        }
      };
      const fredProtocol = new Protocol(fredDef, LORE_DEFAULT_CONFIG);
      registry.register(fredProtocol);

      // 3. Create atom containing both Lore and Fred interpretations
      const mixedAtom = makeAtom({
        id: 'l1',
        body: 'Shared body',
        trailers: makeTrailers({ 'Lore-id': ['l1'], Confidence: ['high'] })
      });
      // Add Fred interpretation manually to the mock atom
      mixedAtom.protocols.set('fred', {
          name: 'Fred',
          version: '1.0',
          identityKey: 'Fred-id',
          trailers: { 'Fred-id': ['f1'], 'Fred-Level': ['critical'] }
      });

      const { message, protocols } = merger.merge([mixedAtom], { subject: 'Merged multi' });

      // 4. Verify Identity Generation
      expect(protocols.lore.id).toBe('deadbeef');
      expect(protocols.fred.id).toBe('deadbeef'); // Mock idGen returns same value

      // 5. Verify Combined Message
      expect(message).toContain('Lore-id: deadbeef');
      expect(message).toContain('fred/Fred-id: deadbeef'); // Identity MUST be namespaced
      expect(message).toContain('Confidence: high');
      expect(message).toContain('fred/Fred-Level: critical');
    });
  });
});
