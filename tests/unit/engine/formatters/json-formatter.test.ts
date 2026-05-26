import { describe, it, expect, beforeEach } from 'vitest';
import { JsonFormatter } from '../../../../src/engine/formatters/json-formatter.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { LoreProtocolDefinition } from '../../../../src/lore/protocol-definition.js';
import { LORE_DEFAULT_CONFIG } from '../../../../src/lore/defaults.js';
import type {
  FormattableQueryResult,
  FormattableStalenessResult,
} from '../../../../src/engine/types/output.js';
import type { Atom, Trailers } from '../../../../src/engine/types/domain.js';

const LORE_ID_KEY = "Lore-id";

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

function makeAtom(overrides: Partial<Atom> = {}): Atom {
  const trailers = (overrides as any).trailers ?? makeTrailers();
  
  const base: Atom = {
    commitHash: overrides.commitHash ?? 'abc1234567890',
    date: overrides.date ?? new Date('2025-01-15T10:00:00Z'),
    author: overrides.author ?? 'alice@example.com',
    subject: overrides.subject ?? 'feat(auth): add login flow',
    body: overrides.body ?? '',
    protocols: overrides.protocols ?? new Map([
      ['lore', { name: 'Lore', version: '1.0', identityKey: LORE_ID_KEY, trailers }]
    ]),
    filesChanged: overrides.filesChanged ?? ['src/auth.ts'],
  };

  return { ...base, ...overrides };
}

describe('JsonFormatter (Agnostic Core)', () => {
  let registry: ProtocolRegistry;
  let protocol: Protocol;
  let formatter: JsonFormatter;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    protocol = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);
    registry.register(protocol);
    formatter = new JsonFormatter(registry);
  });

  describe('formatQueryResult', () => {
    it('should produce pure agnostic output with "subject" and self-describing protocols', () => {
      const atom = makeAtom();
      const data: FormattableQueryResult = {
        result: {
          command: 'log',
          target: 'all',
          targetType: 'global',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.results[0].subject).toBe('feat(auth): add login flow');
      expect(parsed.results[0].protocols.lore.id).toBe('a1b2c3d4');
      expect(parsed.results[0].protocols.lore.identity_key).toBe('Lore-id');
      expect(parsed.results[0].protocols.lore.version).toBe('1.0');
    });

    it('should use canonical Git keys for trailers (total symmetry)', () => {
      const atom = makeAtom({
        trailers: makeTrailers({
          'Scope-risk': ['wide'],
          'Confidence': ['high']
        })
      });
      const data: FormattableQueryResult = {
        result: {
          command: 'log', target: 'all', targetType: 'global',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      const lore = parsed.results[0].protocols.lore;
      // Truth Check: Canonical keys used on disk must be identical in JSON output
      expect(lore.trailers['Scope-risk']).toBe('wide');
      expect(lore.trailers['Confidence']).toBe('high');
    });
  });

  describe('formatStalenessResult', () => {
    it('should use self-describing protocol structure', () => {
      const atom = makeAtom();
      const data: FormattableStalenessResult = {
        atoms: [{
          atom,
          reasons: [{ signal: 'age', description: 'Too old' }],
        }],
      };

      const output = formatter.formatStalenessResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.stale_atoms[0].protocols.lore.id).toBe('a1b2c3d4');
    });
  });
});
