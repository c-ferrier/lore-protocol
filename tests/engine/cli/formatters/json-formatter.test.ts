import { beforeEach, describe, expect, it } from 'vitest';

import { JsonFormatter } from '../../../../src/engine/cli/formatters/json-formatter.js';
import { ProtocolMap } from '../../../../src/engine/core/models/protocol-map.js';
import type { 
    FormattableDoctorResult, 
    FormattableQueryResult, 
    FormattableStalenessResult, 
    FormattableTraceResult, 
    FormattableValidationResult 
} from '../../../../src/engine/core/types/output.js';
import type { ProtocolContext } from '../../../../src/engine/core/types/protocol-definition.js';
import { 
    makeAtom, 
    makeStubProtocolContext, 
    makeStubProtocolMap,
    makeStubProtocolState,
    MOCK_CORE_TRAILERS,
    TEST_ID_KEY, 
    TEST_PROTOCOL_DEFINITION} from '../../../../src/engine/testing.js';

describe('JsonFormatter', () => {
  let protocols: ProtocolMap<ProtocolContext>;
  let protocol: ProtocolContext;
  let formatter: JsonFormatter;

  beforeEach(() => {
    protocol = makeStubProtocolContext();
    protocols = makeStubProtocolMap([protocol]);
    formatter = new JsonFormatter(protocols);
  });

  describe('formatQueryResult', () => {
    it('should use "subject" key by default and include protocols map', () => {
      const atom = makeAtom({
          commitHash: 'abc1234567890',
          date: new Date('2025-01-15T10:00:00Z'),
          id: 'a1b2c3d4'
      });
      const data: FormattableQueryResult = {
        result: {
          command: 'log',
          target: 'all',
          targetType: 'global',
          atoms: [atom],
          meta: { totalAtoms: 5, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
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
        trailers: {
          Constraint: ['Must use OAuth2'],
          Confidence: ['high'],
        },
      });
      const data: FormattableQueryResult = {
        result: {
          command: 'log', target: 'all', targetType: 'global',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        visibleTrailers: ['Constraint'],
      };
      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);
      expect(parsed.results[0].protocols.mock.trailers.Constraint).toEqual(['Must use OAuth2']);
      expect(parsed.results[0].protocols.mock.trailers.Confidence).toBeUndefined();
    });

    it('should use canonical trailer keys inside protocol object (symmetry)', () => {
      const protocol = makeStubProtocolContext({
          ...TEST_PROTOCOL_DEFINITION,
          trailers: {
              ...TEST_PROTOCOL_DEFINITION.trailers,
              'Confidence': { description: 'c', multivalue: false, validation: 'none' as const }
          }
      });
      const protocols = makeStubProtocolMap([protocol]);
      const dataFormatter = new JsonFormatter(protocols);
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
        visibleTrailers: 'all',
      };
      const output = dataFormatter.formatQueryResult(data);
      const parsed = JSON.parse(output);
      const mock = parsed.results[0].protocols.mock;
      expect(mock.trailers.Confidence).toBe('high');
      expect(mock.trailers['Depends-on']).toEqual(['aabbccdd']);
    });

    it('should include protocol-specific supersession data', () => {
      const atom = makeAtom({
        protocols: makeStubProtocolMap([
          ['mock', makeStubProtocolState({ 
            trailers: { [TEST_ID_KEY]: ['a1b2c3d4'] },
            supersession: { superseded: true, supersededBy: ['e5f6a7b8'] }
          })]
        ])
      });
      const data: FormattableQueryResult = {
        result: {
          command: 'log', target: 'all', targetType: 'global',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        visibleTrailers: 'all',
      };
      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);
      const mock = parsed.results[0].protocols.mock;
      expect(mock.superseded).toBe(true);
      expect(mock.superseded_by).toEqual(['e5f6a7b8']);
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
      const atom = makeAtom({
          date: new Date('2025-01-15T10:00:00.000Z')
      });
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
        summary: { total: 1, errors: 0, warnings: 0, info: 0 },
        status: 'healthy'
      };
      const output = formatter.formatDoctorResult(data);
      const parsed = JSON.parse(output);
      expect(parsed.checks[0].name).toBe('c1');
    });
  });

  describe('JSON Normalization Matrix', () => {
    it('should correctly coerce core scalars and preserve all other arrays', () => {
      const protocol = makeStubProtocolContext({
          ...TEST_PROTOCOL_DEFINITION,
          trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
      });
      const protocols = makeStubProtocolMap([protocol]);
      const formatter = new JsonFormatter(protocols);
      const trailers: Record<string, string[]> = {
        [TEST_ID_KEY]: ['id'],
        'Confidence': ['high'],      // Scalar core
        'Constraint': ['C1', 'C2'],  // Array core
        'Custom': ['V1'],            // Custom (defaults to array)
      };
      const atom = makeAtom({
        protocols: makeStubProtocolMap([
          ['mock', makeStubProtocolState({ trailers })]
        ])
      });
      const data: FormattableQueryResult = {
        result: { atoms: [atom], meta: { totalAtoms: 1, filteredAtoms: 1, oldest: null, newest: null }, command: 'log', target: 't', targetType: 'path' },
        visibleTrailers: 'all',
      };
      const output = JSON.parse(formatter.formatQueryResult(data));
      const mock = output.results[0].protocols.mock;
      expect(mock.trailers.Confidence).toBe('high');        // Canonical Key + Coerced to scalar
      expect(mock.trailers.Constraint).toEqual(['C1', 'C2']); // Canonical Key + Remained array
      expect(mock.trailers.Custom).toEqual(['V1']);           // Remained array
    });
  });
});
