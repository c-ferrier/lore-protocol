import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TextFormatter } from '../../../../src/engine/formatters/text-formatter.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { TEST_PROTOCOL_DEFINITION, TEST_ENGINE_CONFIG, makeProtocol } from '../../engine-test-utils.js';

import type { Atom, Trailers, SupersessionStatus } from '../../../../src/engine/types/domain.js';
import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
} from '../../../../src/engine/types/output.js';

const TEST_ID_KEY = "Mock-id";

function makeTrailers(overrides: Partial<Trailers> = {}): Trailers {
  return {
    [TEST_ID_KEY]: overrides[TEST_ID_KEY] ?? ['a1b2c3d4'],
    Constraint: overrides.Constraint ?? [],
    Confidence: overrides.Confidence ?? [],
    Related: overrides.Related ?? [],
    ...overrides,
  } as any;
}

function makeAtom(overrides: Partial<Atom> & { id?: string } = {}): Atom {
  let trailers = overrides.protocols?.get('mock')?.trailers ?? makeTrailers();
  
  const id = overrides.id || (trailers[TEST_ID_KEY]?.[0] || 'a1b2c3d4');

  if (trailers[TEST_ID_KEY]?.[0] !== id) {
     trailers = { ...trailers, [TEST_ID_KEY]: [id] } as any;
  }
  
  return {
    commitHash: overrides.commitHash ?? 'abc1234567890',
    date: overrides.date ?? new Date('2025-01-15T10:00:00Z'),
    author: overrides.author ?? 'alice@example.com',
    subject: overrides.subject ?? 'feat(auth): add login flow',
    body: overrides.body ?? '',
    protocols: overrides.protocols ?? new Map([
      ['mock', { name: 'Mock', version: '1.0', identityKey: TEST_ID_KEY, trailers }]
    ]),
    filesChanged: overrides.filesChanged ?? ['src/auth.ts'],
    ...overrides,
  } as any;
}

describe('TextFormatter', () => {
  let registry: ProtocolRegistry;
  let protocol: Protocol;
  let formatter: TextFormatter;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    protocol = makeProtocol();
    registry.register(protocol);
    formatter = new TextFormatter(registry, { color: false });
  });

  describe('formatQueryResult', () => {
    it('should show "No decision atoms found." when empty', () => {
      const data: FormattableQueryResult = {
        result: {
          command: 'log',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [],
          meta: { totalAtoms: 0, filteredAtoms: 0, oldest: null, newest: null },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('No decision atoms found.');
    });

    it('should format atoms with header and trailers', () => {
      const atom = makeAtom({
        protocols: new Map([
          ['mock', { 
            name: 'Mock', 
            version: '1.0', 
            identityKey: TEST_ID_KEY, 
            trailers: makeTrailers({
              Constraint: ['Must use OAuth2'],
              Confidence: ['high'],
            }) 
          }]
        ])
      });
      const data: FormattableQueryResult = {
        result: {
          command: 'log',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: {
            totalAtoms: 1,
            filteredAtoms: 1,
            oldest: atom.date,
            newest: atom.date,
          },
        },
        supersessionMap: new Map([['a1b2c3d4', { superseded: false, supersededBy: null }]]),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('a1b2c3d4');
      expect(output).toContain('2025-01-15');
      expect(output).toContain('alice@example.com');
      expect(output).toContain('[Mock] Constraint: Must use OAuth2');
      expect(output).toContain('[Mock] Confidence: high');
    });

    it('should show supersession info for superseded atoms', () => {
      const atom = makeAtom();
      const supersessionMap = new Map<string, SupersessionStatus>([
        ['a1b2c3d4', { superseded: true, supersededBy: 'e5f6a7b8' }],
      ]);

      const data: FormattableQueryResult = {
        result: {
          command: 'log',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap,
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('superseded by e5f6a7b8');
    });

    it('should filter visible trailers', () => {
      const atom = makeAtom({
        protocols: new Map([
          ['mock', {
            name: 'Mock',
            version: '1.0',
            identityKey: TEST_ID_KEY,
            trailers: makeTrailers({
              Constraint: ['Must use OAuth2'],
              Confidence: ['high'],
            })
          }]
        ])
      });
      const data: FormattableQueryResult = {
        result: {
          command: 'log',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map([['a1b2c3d4', { superseded: false, supersededBy: null }]]),
        visibleTrailers: ['Constraint'],
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('[Mock] Constraint: Must use OAuth2');
      expect(output).not.toContain('Confidence:');
    });

    it('should render unregistered (adhoc) trailers in dim color', () => {
      const atom = makeAtom({
        protocols: new Map([
          ['mock', {
            name: 'Mock',
            version: '1.0',
            identityKey: TEST_ID_KEY,
            trailers: makeTrailers({
              'Assisted-by': ['Gemini'],
            })
          }]
        ])
      });

      const data: FormattableQueryResult = {
        result: {
          command: 'search',
          target: 'all',
          targetType: 'search',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map([['a1b2c3d4', { superseded: false, supersededBy: null }]]),
        visibleTrailers: 'all',
      };

      // We need to enable color for this test
      const coloredFormatter = new TextFormatter(registry, { color: true });
      const output = coloredFormatter.formatQueryResult(data);

      // Check for presence of key and value
      expect(output).toContain('Assisted-by:');
      expect(output).toContain('Gemini');
      // Verify that it contains some escape sequence when color is on
      expect(output).toMatch(/\x1b\[/);
    });

    it('should show body text when present', () => {
      const atom = makeAtom({ body: 'Detailed explanation here.' });
      const data: FormattableQueryResult = {
        result: {
          command: 'log',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map([['a1b2c3d4', { superseded: false, supersededBy: null }]]),
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
          targetType: 'file',
          atoms: [atom],
          meta: { totalAtoms: 5, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map([['a1b2c3d4', { superseded: false, supersededBy: null }]]),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('1 of 5 atoms shown');
    });

    it('should display trailers from multiple protocols with prefixes', () => {
      const trailers = makeTrailers({ Confidence: ['high'] });
      const fredTrailers = { 'Fred-id': ['f8ed5678'], Status: ['active'] };
      
      const atom: Atom = {
        ...makeAtom({ id: 'mock1234' }),
        protocols: new Map([
          ['mock', { name: 'Mock', version: '1.0', identityKey: TEST_ID_KEY, trailers }],
          ['fred', { name: 'Fred', version: '2.0', identityKey: 'Fred-id', trailers: fredTrailers as any }]
        ])
      } as any;

      // Register Fred protocol so the formatter can find its metadata
      const fredProtocol: any = {
        name: 'Fred',
        namespace: 'fred',
        identityKey: 'Fred-id',
        getIdentity: (trailers: any) => trailers['Fred-id']?.[0] || null,
        getFormattableDefinitions: () => ({}),
        getAuthorizedKeys: () => ['Status'],
        setRegistry: vi.fn(),
      };
      registry.register(fredProtocol);

      const data: FormattableQueryResult = {
        result: {
          command: 'search',
          target: 'all',
          targetType: 'search',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      
      // Mock should be prefixed in total neutrality
      expect(output).toContain('[Mock] Confidence: high');
      
      // Fred should be prefixed
      expect(output).toContain('[Fred] Status: active');
      // Should show Fred ID because it differs from header ID (mock1234)
      expect(output).toContain('[Fred] Fred-id: f8ed5678');
    });
  });

  describe('formatValidationResult', () => {
    it('should show checkmark for valid commits', () => {
      const data: FormattableValidationResult = {
        summary: { commitsChecked: 1, errors: 0, warnings: 0 },
        results: [
          {
            commit: 'abc1234567890',
            id: 'a1b2c3d4',
            valid: true,
            issues: [],
          },
        ],
        valid: true
      };

      const output = formatter.formatValidationResult(data);
      expect(output).toContain('\u2713');
      expect(output).toContain('a1b2c3d4');
      expect(output).toContain('all valid');
    });

    it('should show X marks for invalid commits', () => {
      const data: FormattableValidationResult = {
        summary: { errors: 1, warnings: 1, commitsChecked: 1 },
        results: [
          {
            commit: 'abc1234567890',
            id: null,
            valid: false,
            issues: [
              { severity: 'error', rule: 'mock-id-present', message: `${TEST_ID_KEY} trailer is missing` },
              { severity: 'warning', rule: 'subject-length', message: 'Subject too long' },
            ],
          },
        ],
        valid: false
      };

      const output = formatter.formatValidationResult(data);
      expect(output).toContain('\u2717');
      expect(output).toContain('mock-id-present');
      expect(output).toContain(`${TEST_ID_KEY} trailer is missing`);
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
      const atom = makeAtom();
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
      expect(output).toContain('a1b2c3d4');
      expect(output).toContain('2025-01-15');
      expect(output).toContain('Older than 6 months');
      expect(output).toContain('Low confidence');
    });
  });

  describe('formatTraceResult', () => {
    it('should show root and edges with tree characters', () => {
      const root = makeAtom({ id: 'aaaabbbb' });
      const targetAtom = makeAtom({ id: 'ccccdddd', subject: 'related change' });
      const data: FormattableTraceResult = {
        root,
        edges: [
          { from: 'aaaabbbb', to: 'ccccdddd', relationship: 'Related', targetAtom },
        ],
      };

      const output = formatter.formatTraceResult(data);
      expect(output).toContain('aaaabbbb');
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
          { name: 'duplicates', status: 'error', message: `2 duplicate ${TEST_ID_KEY}s`, details: ['a1b2c3d4', 'e5f6a7b8'] },
        ],
        summary: { errors: 1, warnings: 1, info: 0 },
      };

      const output = formatter.formatDoctorResult(data);
      expect(output).toContain('OK');
      expect(output).toContain('git-version');
      expect(output).toContain('WARNING');
      expect(output).toContain('No config found');
      expect(output).toContain('Using defaults');
      expect(output).toContain('ERROR');
      expect(output).toContain(`2 duplicate ${TEST_ID_KEY}s`);
      expect(output).toContain('1 errors');
      expect(output).toContain('1 warnings');
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
      expect(output).not.toMatch(/\x1b\[/);
    });
  });
});
