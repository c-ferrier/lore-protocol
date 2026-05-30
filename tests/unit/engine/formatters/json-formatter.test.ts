import { describe, it, expect, beforeEach } from 'vitest';
import { JsonFormatter } from '../../../../src/engine/formatters/json-formatter.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { TEST_PROTOCOL_DEFINITION, TEST_ENGINE_CONFIG, makeProtocol } from '../test-utils.js';
import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
} from '../../../../src/engine/types/output.js';
import type { Atom, Trailers } from '../../../../src/engine/types/domain.js';

const TEST_ID_KEY = "Mock-id";

function makeTrailers(overrides: Partial<Trailers> = {}): Trailers {
  return {
    [TEST_ID_KEY]: overrides[TEST_ID_KEY] ?? ['a1b2c3d4'],
    Constraint: overrides.Constraint ?? [],
    Confidence: overrides.Confidence ?? [],
    Related: overrides.Related ?? [],
    Ref: overrides.Ref ?? [],
    ...overrides,
  } as any;
}

function makeAtom(overrides: Partial<Atom> & { id?: string } = {}): Atom {
  let trailers = (overrides as any).trailers ?? makeTrailers();
  const id = overrides.id ?? trailers[TEST_ID_KEY][0];

  if (trailers[TEST_ID_KEY][0] !== id) {
      trailers = { ...trailers, [TEST_ID_KEY]: [id] } as any;
  }
  
  const base: Atom = {
    commitHash: overrides.commitHash ?? 'abc1234567890',
    date: overrides.date ?? new Date('2025-01-15T10:00:00Z'),
    author: overrides.author ?? 'alice@example.com',
    subject: overrides.subject ?? 'feat(auth): add login flow',
    body: overrides.body ?? '',
    protocols: overrides.protocols ?? new Map([
      ['mock', { name: 'Mock', version: '1.0', identityKey: TEST_ID_KEY, trailers }]
    ]),
    filesChanged: overrides.filesChanged ?? ['src/auth.ts'],
  };

  return { ...base, ...overrides };
}

describe('JsonFormatter', () => {
  let registry: ProtocolRegistry;
  let protocol: Protocol;
  let formatter: JsonFormatter;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    protocol = makeProtocol();
    registry.register(protocol);
    formatter = new JsonFormatter(registry);
  });

  describe('formatQueryResult', () => {
    it('should use "subject" key by default and include protocols map', () => {
      const atom = makeAtom();
      const data: FormattableQueryResult = {
        result: {
          command: 'log',
          target: 'all',
          targetType: 'global',
          atoms: [atom],
          meta: { totalAtoms: 5, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.version).toBe('1.0');
      expect(parsed.meta.total_atoms).toBe(5);
      expect(parsed.meta.filtered_atoms).toBe(1);
      expect(parsed.results[0].protocols.mock.id).toBe('a1b2c3d4');
      expect(parsed.results[0].protocols.mock.version).toBe('1.0');
      expect(parsed.results[0].commit).toBe('abc1234567890');
    });

    it('should include filtered trailers inside protocol object', () => {
      const atom = makeAtom({
        trailers: makeTrailers({
          Constraint: ['Must use OAuth2'],
          Confidence: ['high'],
        }),
      });
      const data: FormattableQueryResult = {
        result: {
          command: 'log', target: 'all', targetType: 'global',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map(),
        visibleTrailers: ['Constraint'],
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.results[0].protocols.mock.trailers.Constraint).toEqual(['Must use OAuth2']);
      expect(parsed.results[0].protocols.mock.trailers.Confidence).toBeUndefined();
    });

    it('should use canonical trailer keys inside protocol object (symmetry)', () => {
      const registry = new ProtocolRegistry();
      const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
      registry.register(protocol);
      const dataFormatter = new JsonFormatter(registry);

      const atom = makeAtom({
        trailers: {
          [TEST_ID_KEY]: ['abcd1234'],
          Confidence: ['high'],
          'Depends-on': ['aabbccdd'],
        },
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

      const output = dataFormatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      const mock = parsed.results[0].protocols.mock;
      expect(mock.trailers.Confidence).toBe('high');
      expect(mock.trailers['Depends-on']).toEqual(['aabbccdd']);
    });
  });

  describe('formatValidationResult', () => {
    it('should produce valid JSON summary', () => {
      const data: FormattableValidationResult = {
        summary: { commitsChecked: 10, errors: 2, warnings: 5 },
        results: [],
        valid: false
      };

      const output = formatter.formatValidationResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.summary.commits_checked).toBe(10);
      expect(parsed.summary.errors).toBe(2);
      expect(parsed.valid).toBe(false);
    });
  });

  describe('formatStalenessResult', () => {
    it('should produce valid JSON with stale atoms', () => {
      const atom = makeAtom();
      const data: FormattableStalenessResult = {
        atoms: [
          {
            atom,
            reasons: [{ signal: 'age', description: 'Too old' }],
          },
        ],
      };

      const output = formatter.formatStalenessResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.version).toBe('1.0');
      expect(parsed.stale_atoms).toHaveLength(1);
      expect(parsed.stale_atoms[0].protocols.mock.id).toBe('a1b2c3d4');
      expect(parsed.stale_atoms[0].date).toBe('2025-01-15T10:00:00.000Z');
    });
  });

  describe('formatTraceResult', () => {
    it('should produce valid JSON with root and edges', () => {
      const root = makeAtom({ id: 'aaaabbbb' });
      const targetAtom = makeAtom({ id: 'ccccdddd' });
      const data: FormattableTraceResult = {
        root,
        edges: [
          { from: 'aaaabbbb', to: 'ccccdddd', relationship: 'Related', targetAtom },
          { from: 'aaaabbbb', to: 'eeeeffff', relationship: 'Supersedes', targetAtom: null },
        ],
      };

      const output = formatter.formatTraceResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.version).toBe('1.0');
      expect(parsed.root.protocols.mock.id).toBe('aaaabbbb');
      expect(parsed.edges).toHaveLength(2);
      expect(parsed.edges[0].target_atom.protocols.mock.id).toBe('ccccdddd');
    });
  });

  describe('formatDoctorResult', () => {
    it('should produce valid JSON for doctor results', () => {
      const data: FormattableDoctorResult = {
        checks: [
          { name: 'c1', status: 'ok', message: 'm1', details: [] },
        ],
        summary: { errors: 0, warnings: 0, info: 0 },
      };

      const output = formatter.formatDoctorResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.checks[0].name).toBe('c1');
    });
  });
});
