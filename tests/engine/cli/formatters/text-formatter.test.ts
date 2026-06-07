import { beforeEach, describe, expect, it } from 'vitest';

import { TextFormatter } from '../../../../src/engine/cli/formatters/text-formatter.js';
import { type ProtocolState, type Trailers } from '../../../../src/engine/core/types/domain.js';
import type { 
    FormattableConfigResult,
    FormattableDoctorResult, 
    FormattableQueryResult, 
    FormattableStalenessResult, 
    FormattableTraceResult, 
    FormattableValidationResult 
} from '../../../../src/engine/core/types/output.js';
import type { ProtocolContext } from '../../../../src/engine/core/types/protocol-definition.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { makeAtom, makeStubProtocolContext, TEST_ID_KEY } from '../../../../src/engine/testing.js';

describe('TextFormatter', () => {
  let registry: ProtocolRegistry;
  let protocol: ProtocolContext;
  let formatter: TextFormatter;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    protocol = makeStubProtocolContext();
    registry.register(protocol);
    formatter = new TextFormatter(registry, { color: false });
  });

  describe('formatQueryResult', () => {
    it('should strike-through the header for superseded atoms', () => {
      const atom = makeAtom({
        commitHash: 'abc1234567890',
        protocols: new Map<string, ProtocolState>([
          ['mock', { 
            trailers: { [TEST_ID_KEY]: ['abc1234'] },
            unauthorized: {},
            supersession: { superseded: true, supersededBy: ['e5f6a7b8'] }
          }]
        ])
      });

      const data: FormattableQueryResult = {
        result: {
          command: 'log',
          target: 'src/auth.ts',
          targetType: 'path',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('abc1234');
      expect(output).toContain('[mock] (superseded by e5f6a7b8)');
    });

    it('should show "No decision atoms found." when empty', () => {
      const data: FormattableQueryResult = {
        result: {
          command: 'log',
          target: 'src/auth.ts',
          targetType: 'path',
          atoms: [],
          meta: { totalAtoms: 0, filteredAtoms: 0, oldest: null, newest: null },
        },
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('No decision atoms found.');
    });

    it('should format atoms with header and trailers', () => {
      const atom = makeAtom({
        commitHash: 'abc1234',
        date: new Date('2025-01-15T10:00:00Z'),
        author: 'alice@example.com',
        trailers: {
          Constraint: ['Must use OAuth2'],
          Confidence: ['high'],
        }
      });
      const data: FormattableQueryResult = {
        result: {
          command: 'log',
          target: 'src/auth.ts',
          targetType: 'path',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('abc1234');
      expect(output).toContain('2025-01-15');
      expect(output).toContain('alice@example.com');
      expect(output).toContain('[mock] Constraint: Must use OAuth2');
      expect(output).toContain('[mock] Confidence: high');
    });

    it('should filter visible trailers', () => {
      const atom = makeAtom({
        trailers: {
          Constraint: ['Must use OAuth2'],
          Confidence: ['high'],
        }
      });
      const data: FormattableQueryResult = {
        result: {
          command: 'log',
          target: 'src/auth.ts',
          targetType: 'path',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        visibleTrailers: ['Constraint'],
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('[mock] Constraint: Must use OAuth2');
      expect(output).not.toContain('Confidence:');
    });

    it('should render unregistered (adhoc) trailers in dim color', () => {
      const atom = makeAtom({
        trailers: {
          'Assisted-by': ['Gemini'],
        }
      });

      const data: FormattableQueryResult = {
        result: {
          command: 'search',
          target: 'all',
          targetType: 'global',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        visibleTrailers: 'all',
      };

      const coloredFormatter = new TextFormatter(registry, { color: true });
      const output = coloredFormatter.formatQueryResult(data);

      expect(output).toContain('Assisted-by:');
      expect(output).toContain('Gemini');
      // eslint-disable-next-line no-control-regex
      expect(output).toMatch(new RegExp('\\x1b\\['));
    });

    it('should show body text when present', () => {
      const atom = makeAtom({ body: 'Detailed explanation here.' });
      const data: FormattableQueryResult = {
        result: {
          command: 'log',
          target: 'src/auth.ts',
          targetType: 'path',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('Detailed explanation here.');
    });

    it('should show meta summary at bottom', () => {
      const atom = makeAtom();
      const data: FormattableQueryResult = {
        result: {
          command: 'log',
          target: 'src/auth.ts',
          targetType: 'path',
          atoms: [atom],
          meta: { totalAtoms: 5, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('1 of 5 atoms shown');
    });

    it('should display trailers from multiple protocols with prefixes', () => {
      const trailers: Trailers = { Confidence: ['high'] };
      const fredTrailers: Trailers = { 'Fred-id': ['f8ed5678'], Status: ['active'] };
      
      const atom = makeAtom({
        id: 'mock1234',
        protocols: new Map<string, ProtocolState>([
          ['mock', { trailers, unauthorized: {} }],
          ['fred', { trailers: fredTrailers, unauthorized: {} }]
        ])
      });

      const fredProtocol = makeStubProtocolContext({
        name: 'Fred',
        namespace: 'fred',
        identityKey: 'Fred-id',
        trailers: { 'Status': { description: 'S', multivalue: true, validation: 'none' } }
      });
      registry.register(fredProtocol);

      const data: FormattableQueryResult = {
        result: {
          command: 'search',
          target: 'all',
          targetType: 'global',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('[mock] Confidence: high');
      expect(output).toContain('[fred] Status: active');
      expect(output).toContain('[fred] Fred-id: f8ed5678');
    });
  });

  describe('formatValidationResult', () => {
    it('should show checkmark for valid commits', () => {
      const data: FormattableValidationResult = {
        summary: { commitsChecked: 1, errors: 0, warnings: 0 },
        results: [
          {
            commit: 'abc1234567890',
            valid: true,
            issues: [],
            identities: {},
          },
        ],
        valid: true
      };

      const output = formatter.formatValidationResult(data);
      expect(output).toContain('\u2713');
      expect(output).toContain('abc1234');
      expect(output).toContain('all valid');
    });

    it('should show X marks for invalid commits', () => {
      const data: FormattableValidationResult = {
        summary: { errors: 1, warnings: 1, commitsChecked: 1 },
        results: [
          {
            commit: 'abc1234567890',
            valid: false,
            issues: [
              { severity: 'error', rule: 'mock-id-present', message: `Mock-id trailer is missing` },
              { severity: 'warning', rule: 'subject-length', message: 'Subject too long' },
            ],
            identities: {},
          },
        ],
        valid: false
      };

      const output = formatter.formatValidationResult(data);
      expect(output).toContain('\u2717');
      expect(output).toContain('mock-id-present');
      expect(output).toContain(`Mock-id trailer is missing`);
      expect(output).toContain('\u26A0');
      expect(output).toContain('Subject too long');
      expect(output).toContain('1 errors');
      expect(output).toContain('1 warnings');
    });
  });

  describe('formatStalenessResult', () => {
    it('should show message when no stale atoms', () => {
      const data: FormattableStalenessResult = { atoms: [] };
      const output = formatter.formatStalenessResult(data);
      expect(output).toContain('No stale atoms found');
    });

    it('should show STALE label with reasons', () => {
      const atom = makeAtom({ commitHash: 'abc1234', date: new Date('2025-01-15T10:00:00.000Z') });
      const data: FormattableStalenessResult = {
        atoms: [
          {
            atom,
            reasons: [
              { signal: 'age', description: 'Older than 6 months' },
              { signal: 'low-confidence', description: 'Low confidence' },
            ],
          },
        ],
      };

      const output = formatter.formatStalenessResult(data);
      expect(output).toContain('STALE');
      expect(output).toContain('abc1234');
      expect(output).toContain('2025-01-15');
      expect(output).toContain('Older than 6 months');
      expect(output).toContain('Low confidence');
    });
  });

  describe('formatTraceResult', () => {
    it('should show root and edges with tree characters', () => {
      const root = makeAtom({ commitHash: 'abc1234' });
      const targetAtom = makeAtom({ id: 'ccccdddd', subject: 'related change' });
      const data: FormattableTraceResult = {
        root,
        edges: [
          { from: 'abc1234', to: 'ccccdddd', relationship: 'Related', targetAtom },
        ],
      };

      const output = formatter.formatTraceResult(data);
      expect(output).toContain('abc1234');
      expect(output).toContain('\u2514\u2500\u2500');
      expect(output).toContain('[Related]');
      expect(output).toContain('ccccdddd');
      expect(output).toContain('related change');
    });
  });

  describe('formatDoctorResult', () => {
    it('should show check statuses with labels', () => {
      const data: FormattableDoctorResult = {
        checks: [
          { name: 'git-version', status: 'ok', message: 'Git 2.40+ detected', details: [] },
          { name: 'config', status: 'warning', message: 'No config found', details: ['Using defaults'] },
          { name: 'duplicates', status: 'error', message: `2 duplicate Mock-ids`, details: ['abc1234', 'e5f6a7b8'] },
        ],
        summary: { total: 1, errors: 1, warnings: 1, info: 0 },
        status: 'unhealthy'
      };

      const output = formatter.formatDoctorResult(data);
      expect(output).toContain('OK');
      expect(output).toContain('git-version');
      expect(output).toContain('WARNING');
      expect(output).toContain('No config found');
      expect(output).toContain('Using defaults');
      expect(output).toContain('ERROR');
      expect(output).toContain(`2 duplicate Mock-ids`);
      expect(output).toContain('1 errors');
      expect(output).toContain('1 warnings');
    });
  });

  describe('formatConfig', () => {
    it('should format hierarchical protocol config', () => {
      const data: FormattableConfigResult = {
        engineVersion: '1.2.3',
        protocols: [
          {
            name: 'Lore',
            version: '1.0',
            namespace: '',
            permissive: true,
            trailers: {
              Confidence: {
                description: 'C',
                multivalue: false,
                validation: 'values',
                isCore: true,
                directives: [],
                values: { high: { description: 'H' } },
              },
            },
          },
          {
            name: 'Sec',
            version: '2.0',
            namespace: 'sec',
            permissive: false,
            trailers: {
              Level: {
                description: 'L',
                multivalue: false,
                validation: 'none',
                isCore: false,
                directives: [],
              },
            },
          },
        ],
      };

      const output = formatter.formatConfig(data);
      expect(output).toContain('Active Protocol Configurations (Engine v1.2.3)');
      expect(output).toContain('Protocol: Lore (v1.0)');
      expect(output).toContain('Namespace: (none), Permissive: true');
      expect(output).toContain('Confidence: C');
      expect(output).toContain('Allowed values: high');
      
      expect(output).toContain('Protocol: Sec (v2.0)');
      expect(output).toContain('Namespace: "sec", Permissive: false');
      expect(output).toContain('Level: L');
    });

    it('should show message when no matching trailers are present', () => {
        const data: FormattableConfigResult = {
            engineVersion: '1.0',
            protocols: [{
                name: 'Empty', version: '0.1', namespace: 'e', permissive: true,
                trailers: {}
            }]
        };
        const output = formatter.formatConfig(data);
        expect(output).toContain('(No matching trailers defined)');
    });
  });

  describe('formatSuccess', () => {
    it('should return the message', () => {
      const output = formatter.formatSuccess('Operation successful');
      expect(output).toContain('Operation successful');
    });
  });

  describe('color support', () => {
    it('should produce output with color disabled', () => {
      const noColor = new TextFormatter(registry, { color: false });
      const output = noColor.formatSuccess('OK');
      // eslint-disable-next-line no-control-regex
      expect(output).not.toMatch(new RegExp('\\x1b\\['));
    });
  });
});
