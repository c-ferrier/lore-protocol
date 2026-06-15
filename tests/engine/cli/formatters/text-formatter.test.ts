import { beforeEach, describe, expect, it } from 'vitest';

import { TextFormatter } from '../../../../src/engine/cli/formatters/text-formatter.js';
import { ProtocolMap } from '../../../../src/engine/core/models/protocol-map.js';
import type { Trailers } from '../../../../src/engine/core/types/domain.js';
import type { 
    FormattableConfigResult,
    FormattableDoctorResult, 
    FormattableStalenessResult, 
    FormattableTraceResult, 
    FormattableValidationResult 
} from '../../../../src/engine/core/types/output.js';
import type { ProtocolContext } from '../../../../src/engine/core/types/protocol-definition.js';
import { 
    makeAtom, 
    makeStubProtocolContext, 
    makeStubProtocolMap,
    makeStubProtocolState } from '../../../../src/engine/testing.js';

describe('TextFormatter', () => {
  let protocols: ProtocolMap<ProtocolContext>;
  let protocol: ProtocolContext;
  let formatter: TextFormatter;

  beforeEach(() => {
    protocol = makeStubProtocolContext();
    protocols = makeStubProtocolMap([protocol]);
    formatter = new TextFormatter(protocols, { color: false });
  });

  describe('formatQueryHeader', () => {
    it('should format the query header with target and type', () => {
        const output = formatter.formatQueryHeader({ target: 'src/auth.ts', type: 'path', visibleTrailers: 'all' });
        expect(output).toContain('Query: src/auth.ts (path)');
    });
  });

  describe('formatQueryAtom', () => {
    it('should format atoms with date and author', () => {
      const atom = makeAtom({
        commitHash: 'abc1234',
        date: new Date('2025-01-15T10:00:00Z'),
        author: 'alice@example.com',
        trailers: {
          Constraint: ['Must use OAuth2'],
          Confidence: ['high'],
        }
      });

      const output = formatter.formatQueryAtom({ atom, visibleTrailers: 'all' });
      expect(output).toContain('abc1234');
      expect(output).toContain('2025-01-15');
      expect(output).toContain('alice@example.com');
      expect(output).toContain('Constraint: Must use OAuth2');
      expect(output).toContain('[mock] Confidence: high');
    });

    it('should filter visible trailers', () => {
      const atom = makeAtom({
        trailers: {
          Constraint: ['Must use OAuth2'],
          Confidence: ['high'],
        }
      });
      const output = formatter.formatQueryAtom({ atom, visibleTrailers: ['Constraint'] });
      expect(output).toContain('Constraint: Must use OAuth2');
      expect(output).not.toContain('Confidence:');
    });

    it('should display trailers from multiple protocols with prefixes', () => {
      const trailers: Trailers = { Confidence: ['high'] };
      const fredTrailers: Trailers = { 'Fred-id': ['f8ed5678'], Status: ['active'] };
      
      const atom = makeAtom({
        id: 'mock1234',
        protocols: makeStubProtocolMap([
          ['mock', makeStubProtocolState({ trailers })],
          ['fred', makeStubProtocolState({ trailers: fredTrailers })]
        ])
      });

      const fredProtocol = makeStubProtocolContext({
        name: 'Fred',
        namespace: 'fred',
        identityKey: 'Fred-id',
        trailers: { 'Status': { description: 'S', multivalue: true, validation: 'none' } }
      });
      protocols.set(fredProtocol.name.toLowerCase(), fredProtocol);

      const output = formatter.formatQueryAtom({ atom, visibleTrailers: 'all' });
      expect(output).toContain('[mock] Confidence: high');
      expect(output).toContain('[fred] Status: active');
      expect(output).toContain('[fred] Fred-id: f8ed5678');
    });

    it('should show body text when present', () => {
      const atom = makeAtom({ body: 'Detailed explanation here.' });
      const output = formatter.formatQueryAtom({ atom, visibleTrailers: 'all' });
      expect(output).toContain('Detailed explanation here.');
    });

    it('should render unregistered (adhoc) trailers', () => {
      const atom = makeAtom({
        trailers: {
          'Assisted-by': ['Gemini'],
        }
      });

      const output = formatter.formatQueryAtom({ atom, visibleTrailers: 'all' });
      expect(output).toContain('Assisted-by:');
      expect(output).toContain('Gemini');
    });

    it('should support colored output', () => {
      const coloredFormatter = new TextFormatter(protocols, { color: true });
      const atom = makeAtom({ commitHash: 'abc12345' });
      const output = coloredFormatter.formatQueryAtom({ atom, visibleTrailers: 'all' });
      
      // Check for bold/color ANSI codes
      expect(output).toContain('\x1b[');
    });
  });

  describe('formatQueryFooter', () => {
    it('should show summary counts', () => {
        const output = formatter.formatQueryFooter({ total: 10, filtered: 2, oldest: null, newest: null });
        expect(output).toContain('2 of 10 atoms shown');
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

  describe('formatConfigResult', () => {
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

      const output = formatter.formatConfigResult(data);
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
        const output = formatter.formatConfigResult(data);
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
      const noColor = new TextFormatter(protocols, { color: false });
      const output = noColor.formatSuccess('OK');
      // eslint-disable-next-line no-control-regex
      expect(output).not.toMatch(new RegExp('\\x1b\\['));
    });
  });
});
