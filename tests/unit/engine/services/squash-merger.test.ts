import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SquashMerger } from '../../../../src/engine/services/squash-merger.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { TEST_PROTOCOL_DEFINITION, makeAtomRepository, TEST_YAP_DEFINITION, makeProtocol, TEST_ENGINE_CONFIG } from '../test-utils.js';

import type { Atom, Trailers } from '../../../../src/engine/types/domain.js';

const TEST_ID_KEY = "Mock-id";

function createMockIdGenerator(id = 'deadbeef') {
  return {
    generate: vi.fn(() => id),
  };
}

function makeTrailers(overrides: Partial<Trailers> = {}): Trailers {
  return {
    [TEST_ID_KEY]: overrides[TEST_ID_KEY] ?? ['a1b2c3d4'],
    Constraint: overrides.Constraint ?? [],
    Confidence: overrides.Confidence ?? [],
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
    subject: overrides.subject ?? 'feat(auth): add login flow',
    body: overrides.body ?? '',
    protocols: new Map([
      ['mock', {
        name: 'Mock',
        version: '1.0',
        identityKey: TEST_ID_KEY,
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
    protocol = makeProtocol();
    registry = new ProtocolRegistry();
    registry.register(protocol);
    merger = new SquashMerger(mockIdGen as any, registry);
  });

  it('should throw for empty atoms', () => {
    expect(() => merger.merge([], {})).toThrow('Cannot merge zero atoms');
  });

  it(`should generate a new ${TEST_ID_KEY}`, () => {
    const atom = makeAtom();
    const { message, protocols } = merger.merge([atom], {});

    expect(mockIdGen.generate).toHaveBeenCalledOnce();
    expect(message).toContain(`${TEST_ID_KEY}: deadbeef`);
    expect(protocols.mock.id).toBe('deadbeef');
  });

  describe('subject merging', () => {
    it('should use options.subject when provided', () => {
      const atom = makeAtom({ subject: 'old subject' });
      const { message } = merger.merge([atom], { subject: 'new subject' });

      expect(message.startsWith('new subject')).toBe(true);
    });

    it('should use newest atom subject when no option provided', () => {
      const older = makeAtom({
        id: 'aaaa0001',
        date: new Date('2025-01-01'),
        subject: 'older subject',
      });
      const newer = makeAtom({
        id: 'aaaa0002',
        date: new Date('2025-06-01'),
        subject: 'newer subject',
      });

      const { message } = merger.merge([older, newer], {});

      expect(message.startsWith('newer subject')).toBe(true);
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
          [TEST_ID_KEY]: ['aaaa0001'],
          Constraint: ['C1', 'C2'],
        }),
      });
      const a2 = makeAtom({
        id: 'aaaa0002',
        trailers: makeTrailers({
          [TEST_ID_KEY]: ['aaaa0002'],
          Constraint: ['C1', 'C3'],
        }),
      });

      const { message } = merger.merge([a1, a2], {});

      expect(message).toContain('Constraint: C1');
      expect(message).toContain('Constraint: C2');
      expect(message).toContain('Constraint: C3');
      const matches = message.match(/Constraint: C1/g);
      expect(matches).toHaveLength(1);
    });
  });

  describe('enum trailer merging', () => {
    it('should pick lowest confidence (most conservative)', () => {
      const a1 = makeAtom({
        id: 'aaaa0001',
        trailers: makeTrailers({ [TEST_ID_KEY]: ['aaaa0001'], Confidence: ['high'] }),
      });
      const a2 = makeAtom({
        id: 'aaaa0002',
        trailers: makeTrailers({ [TEST_ID_KEY]: ['aaaa0002'], Confidence: ['low'] }),
      });

      const { message } = merger.merge([a1, a2], {});
      expect(message).toContain('Confidence: low');
    });

    it('should handle null enum values gracefully', () => {
      const a1 = makeAtom({
        id: 'aaaa0001',
        trailers: makeTrailers({ [TEST_ID_KEY]: ['aaaa0001'], Confidence: ['medium'] }),
      });
      const a2 = makeAtom({
        id: 'aaaa0002',
        trailers: makeTrailers({ [TEST_ID_KEY]: ['aaaa0002'], Confidence: [] }),
      });

      const { message } = merger.merge([a1, a2], {});
      expect(message).toContain('Confidence: medium');
    });

    it('should handle ad-hoc enum values by taking the last seen', () => {
      const a1 = makeAtom({ trailers: { 'Adhoc': ['v1'] } as any });
      const a2 = makeAtom({ trailers: { 'Adhoc': ['v2'] } as any });

      const { message } = merger.merge([a1, a2], {});
      expect(message).toContain('Adhoc: v2');
    });
  });

  describe('reference trailer merging', () => {
    it('should drop internal references (ids within merged set)', () => {
      const a1 = makeAtom({
        id: 'aaaa0001',
        trailers: makeTrailers({
          [TEST_ID_KEY]: ['aaaa0001'],
          Related: ['aaaa0002'],
        }),
      });
      const a2 = makeAtom({
        id: 'aaaa0002',
        trailers: makeTrailers({
          [TEST_ID_KEY]: ['aaaa0002'],
          Related: ['aaaa0001'],
        }),
      });

      const { message } = merger.merge([a1, a2], {});
      expect(message).not.toContain('Related: aaaaa0002');
      expect(message).not.toContain('Related: aaaaa0001');
    });

    it('should preserve external references', () => {
      const a1 = makeAtom({
        id: 'aaaa0001',
        trailers: makeTrailers({ Related: ['eeee9999'] }),
      });
      const { message } = merger.merge([a1], {});
      expect(message).toContain('Related: eeee9999');
    });
  });

  describe('squash strategies', () => {
    it('should respect rank-max (Impact: high > low)', () => {
       const yap = makeProtocol(TEST_YAP_DEFINITION);
       registry.register(yap);
       
       const a1 = makeAtom({ id: 'l1', body: '' });
       a1.protocols.set('yap', { name: 'YAP', version: '2.0', identityKey: 'YAP-id', trailers: { 'Impact': ['low'] } as any });
       
       const a2 = makeAtom({ id: 'l2', body: '' });
       a2.protocols.set('yap', { name: 'YAP', version: '2.0', identityKey: 'YAP-id', trailers: { 'Impact': ['high'] } as any });
       
       const { message } = merger.merge([a1, a2], {});
       expect(message).toContain('yap/Impact: high');
    });
  });

  describe('single atom merge', () => {
    it('should work with a single atom', () => {
      const atom = makeAtom({
        subject: 'single atom subject',
        trailers: makeTrailers({
          [TEST_ID_KEY]: ['a1b2c3d4'],
          Constraint: ['Some constraint'],
          Confidence: ['high'],
        }),
      });

      const { message, protocols } = merger.merge([atom], {});

      expect(message).toContain('single atom subject');
      expect(message).toContain(`${TEST_ID_KEY}: deadbeef`);
      expect(message).toContain('Constraint: Some constraint');
      expect(message).toContain('Confidence: high');
      expect(protocols.mock.id).toBe('deadbeef');
    });
  });


  describe('message structure', () => {
    it('should have proper structure: subject, blank line, body, blank line, trailers', () => {
      const atom = makeAtom({
        id: 'aaaa0001',
        body: 'Atom body text',
        trailers: makeTrailers({ [TEST_ID_KEY]: ['aaaa0001'], Confidence: ['high'] }),
      });

      const { message } = merger.merge([atom], { subject: 'Merged subject' });
      const lines = message.split('\n');

      expect(lines[0]).toBe('Merged subject');
      expect(lines[1]).toBe('');
      expect(lines[2]).toBe('Atom body text');
      expect(lines[3]).toBe('');
      expect(lines[4]).toContain(`${TEST_ID_KEY}: deadbeef`);
    });
  });

  describe('Multi-Protocol Merging', () => {
    it('should synthesize context for multiple registered protocols simultaneously', () => {
      const yap = makeProtocol(TEST_YAP_DEFINITION);
      registry.register(yap);

      const mixedAtom = makeAtom({
        id: 'l1',
        body: 'Shared body',
        trailers: makeTrailers({ 'Mock-id': ['l1'], Confidence: ['high'] })
      });
      mixedAtom.protocols.set('yap', {
          name: 'YAP',
          version: '2.0',
          identityKey: 'YAP-id',
          trailers: { 'YAP-id': ['y1'], 'Impact': ['low'] } as any
      });

      const { message, protocols } = merger.merge([mixedAtom], { subject: 'Merged multi' });

      expect(protocols.mock.id).toBe('deadbeef');
      expect(protocols.yap.id).toBe('deadbeef');

      expect(message).toContain('Mock-id: deadbeef');
      expect(message).toContain('yap/YAP-id: deadbeef');
      expect(message).toContain('Confidence: high');
      expect(message).toContain('yap/Impact: low');
    });
  });
});
