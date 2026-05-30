import { describe, it, expect, beforeEach } from 'vitest';
import { LoreTextFormatter } from '../../../../src/lore/formatters/lore-text-formatter.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { LoreProtocolDefinition } from '../../../../src/lore/protocol-definition.js';
import { 
  TEST_PROTOCOL_DEFINITION, 
  TEST_ENGINE_CONFIG, 
  TEST_PROTOCOL_CONFIG,
  makeProtocolConfig 
} from '../../engine/test-utils.js';
import type { Atom, Trailers } from '../../../../src/engine/types/domain.js';
import type { FormattableQueryResult } from '../../../../src/engine/types/output.js';

const LORE_ID_KEY = "Lore-id";

function makeAtom(overrides: Partial<Atom> & { trailers?: Record<string, string[]> } = {}): Atom {
  const trailers: Trailers = overrides.trailers 
    ? (overrides.trailers as any)
    : {
        [LORE_ID_KEY]: ['a1b2c3d4'],
        Confidence: ['high'],
        'Scope-risk': ['narrow'],
      };

  return {
    commitHash: overrides.commitHash ?? 'abc1234567890',
    date: overrides.date ?? new Date('2025-01-15T10:00:00Z'),
    author: overrides.author ?? 'alice@example.com',
    subject: overrides.subject ?? 'feat: test subject',
    body: overrides.body ?? '',
    protocols: new Map([
      ['lore', { 
          name: 'Lore', 
          version: '1.0', 
          identityKey: LORE_ID_KEY, 
          trailers,
          unauthorized: {}
      }]
    ]),
    filesChanged: ['src/f1.ts'],
    ...overrides,
  };
}

describe('LoreTextFormatter (0.5.0 Parity)', () => {
  let registry: ProtocolRegistry;
  let formatter: LoreTextFormatter;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    registry.register(new Protocol(LoreProtocolDefinition, TEST_PROTOCOL_CONFIG));
    formatter = new LoreTextFormatter(registry, { color: false, subjectLabel: 'Intent' });
  });

  describe('formatSuccess', () => {
    it('should match the "Commit created: <hash>" format', () => {
      const output = formatter.formatSuccess('Some generic message', { hash: 'deadbeef' });
      expect(output).toBe('Commit created: deadbeef');
    });

    it('should fallback to generic message if no hash is provided', () => {
      const output = formatter.formatSuccess('Generic success');
      expect(output).toBe('Generic success');
    });
  });

  describe('formatQueryResult (Log/Context Parity)', () => {
    it('should remove the [Lore] prefix from trailers', () => {
      const atom = makeAtom();
      const data: FormattableQueryResult = {
        result: {
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
          command: 'log', target: 'all', targetType: 'global'
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      
      // Verify Header
      expect(output).toContain('a1b2c3d4 (2025-01-15, alice@example.com)');
      
      // Verify Trailers (No [Lore] prefix)
      expect(output).toContain('  Confidence: high');
      expect(output).toContain('  Scope-risk: narrow');
      expect(output).not.toContain('[Lore]');
    });

    it('should follow 0.5.0 indentation rules for body: first line indented, rest not', () => {
      const atom = makeAtom({ 
        body: 'This is the first line.\nThis is the second line.\nThis is the third.' 
      });
      const data: FormattableQueryResult = {
        result: {
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
          command: 'log', target: 'all', targetType: 'global'
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      const lines = output.split('\n');

      // Line 1: Header
      // Line 2: First body line (indented)
      expect(lines[1]).toBe('  This is the first line.');
      // Line 3: Second body line (NOT indented)
      expect(lines[2]).toBe('This is the second line.');
      expect(lines[3]).toBe('This is the third.');
    });

    it('should show subject only if no trailers are present', () => {
      const atom = makeAtom({ 
        subject: 'pure intent',
        trailers: { [LORE_ID_KEY]: ['a1b2c3d4'] } as any 
      });
      const data: FormattableQueryResult = {
        result: {
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
          command: 'log', target: 'all', targetType: 'global'
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('  pure intent');
      expect(output).not.toContain('Confidence:');
    });

    it('should match the footer format exactly', () => {
      const atom = makeAtom();
      const data: FormattableQueryResult = {
        result: {
          atoms: [atom],
          meta: { totalAtoms: 50, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
          command: 'log', target: 'all', targetType: 'global'
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('1 of 50 atoms shown');
    });
  });
});
