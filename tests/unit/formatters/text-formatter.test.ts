import { describe, it, expect, beforeEach } from 'vitest';
import { TextFormatter } from '../../../src/formatters/text-formatter.js';
import { Protocol } from '../../../src/services/protocol.js';
import { ProtocolRegistry } from '../../../src/services/protocol-registry.js';
import { LoreProtocolDefinition } from '../../../src/protocols/lore.js';
import { DEFAULT_CONFIG } from '../../../src/util/constants.js';

import type { Atom, Trailers, SupersessionStatus } from '../../../src/types/domain.js';
import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
} from '../../../src/types/output.js';

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

function makeAtom(overrides: Partial<Atom> & { id?: string } = {}): Atom {
  let trailers = overrides.protocols?.get('lore')?.trailers ?? makeTrailers();
  
  const id = overrides.id || (trailers[LORE_ID_KEY]?.[0] || 'a1b2c3d4');

  if (trailers[LORE_ID_KEY]?.[0] !== id) {
     trailers = { ...trailers, [LORE_ID_KEY]: [id] } as any;
  }
  
  return {
    id,
    commitHash: overrides.commitHash ?? 'abc1234567890',
    date: overrides.date ?? new Date('2025-01-15T10:00:00Z'),
    author: overrides.author ?? 'alice@example.com',
    intent: overrides.intent ?? 'feat(auth): add login flow',
    body: overrides.body ?? '',
    protocols: overrides.protocols ?? new Map([
      ['lore', { name: 'Lore', version: '1.0', identityKey: LORE_ID_KEY, trailers }]
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
    protocol = new Protocol(LoreProtocolDefinition, DEFAULT_CONFIG);
    registry.register(protocol);
    formatter = new TextFormatter(registry, { color: false });
  });

  describe('formatQueryResult', () => {
    it('should show "No lore atoms found." when empty', () => {
      const data: FormattableQueryResult = {
        result: {
          command: 'context',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [],
          meta: { totalAtoms: 0, filteredAtoms: 0, oldest: null, newest: null },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('No lore atoms found.');
    });

    it('should format atoms with header and trailers', () => {
      const atom = makeAtom({
        protocols: new Map([
          ['lore', { 
            name: 'Lore', 
            version: '1.0', 
            identityKey: LORE_ID_KEY, 
            trailers: makeTrailers({
              Constraint: ['Must use OAuth2'],
              Confidence: ['high'],
            }) 
          }]
        ])
      });
      const data: FormattableQueryResult = {
        result: {
          command: 'constraints',
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
        supersessionMap: new Map([[atom.id, { superseded: false, supersededBy: null }]]),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('a1b2c3d4');
      expect(output).toContain('2025-01-15');
      expect(output).toContain('alice@example.com');
      expect(output).toContain('[Lore] Constraint: Must use OAuth2');
      expect(output).toContain('[Lore] Confidence: high');
    });

    it('should show supersession info for superseded atoms', () => {
      const atom = makeAtom();
      const supersessionMap = new Map<string, SupersessionStatus>([
        ['a1b2c3d4', { superseded: true, supersededBy: 'e5f6a7b8' }],
      ]);

      const data: FormattableQueryResult = {
        result: {
          command: 'context',
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
          ['lore', {
            name: 'Lore',
            version: '1.0',
            identityKey: LORE_ID_KEY,
            trailers: makeTrailers({
              Constraint: ['Must use OAuth2'],
              Confidence: ['high'],
              Rejected: ['Session tokens'],
            })
          }]
        ])
      });
      const data: FormattableQueryResult = {
        result: {
          command: 'constraints',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map([[atom.id, { superseded: false, supersededBy: null }]]),
        visibleTrailers: ['Constraint'],
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('[Lore] Constraint: Must use OAuth2');
      expect(output).not.toContain('Confidence:');
      expect(output).not.toContain('Rejected:');
    });

    it('should render unregistered (adhoc) trailers in dim color', () => {
      const atom = makeAtom({
        protocols: new Map([
          ['lore', {
            name: 'Lore',
            version: '1.0',
            identityKey: LORE_ID_KEY,
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
        supersessionMap: new Map([[atom.id, { superseded: false, supersededBy: null }]]),
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
          command: 'context',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map([[atom.id, { superseded: false, supersededBy: null }]]),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('Detailed explanation here.');
    });

    it('should show meta summary at bottom', () => {
      const atom = makeAtom();
      const data: FormattableQueryResult = {
        result: {
          command: 'context',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: { totalAtoms: 5, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map([[atom.id, { superseded: false, supersededBy: null }]]),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('1 of 5 atoms shown');
    });

    it('should display trailers from multiple protocols with prefixes', () => {
      const trailers = makeTrailers({ Confidence: ['high'] });
      const fredTrailers = { 'Fred-id': ['f8ed5678'], Status: ['active'] };
      
      const atom: Atom = {
        ...makeAtom({ id: 'lore1234' }),
        protocols: new Map([
          ['lore', { name: 'Lore', version: '1.0', identityKey: 'Lore-id', trailers }],
          ['fred', { name: 'Fred', version: '2.0', identityKey: 'Fred-id', trailers: fredTrailers as any }]
        ])
      } as any;

      // Register Fred protocol so the formatter can find its metadata
      const fredProtocol: any = {
        name: 'Fred',
        identityKey: 'Fred-id',
        getFormattableDefinitions: () => ({})
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
      
      // Lore (Primary) should be prefixed in total neutrality
      expect(output).toContain('[Lore] Confidence: high');
      
      // Fred (Secondary) should be prefixed
      expect(output).toContain('[Fred] Status: active');
      // Should show Fred ID because it differs from header ID (lore1234)
      expect(output).toContain('[Fred] Fred-id: f8ed5678');
    });

    it('should show prefixed trailers even if no root protocol is registered', () => {
      const localRegistry = new ProtocolRegistry();
      const fredProtocol = new Protocol({
        ...LoreProtocolDefinition,
        name: 'Fred',
        version: '2.5',
        identityKey: 'Fred-id',
        namespace: 'Fred',
      }, DEFAULT_CONFIG);
      localRegistry.register(fredProtocol);

      const formatterNoRoot = new TextFormatter(localRegistry, { color: false });
      const trailers = { 'Fred-id': ['f1'], Status: ['active'] };
      const atom: Atom = {
        ...makeAtom({ id: 'l1' }),
        protocols: new Map([
          ['fred', { name: 'Fred', version: '2.5', identityKey: 'Fred-id', trailers: trailers as any }]
        ])
      } as any;

      const data: FormattableQueryResult = {
        result: {
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: null, newest: null },
          command: 'search', target: 'all', targetType: 'global'
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatterNoRoot.formatQueryResult(data);
      // In total neutrality mode, everything is prefixed
      expect(output).toContain('[Fred] Status: active');
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
              { severity: 'error', rule: 'lore-id-present', message: `${LORE_ID_KEY} trailer is missing` },
              { severity: 'warning', rule: 'intent-length', message: 'Intent too long' },
            ],
          },
        ],
        valid: false
      };

      const output = formatter.formatValidationResult(data);
      // New semantic UI uses symbols like ✗ and ⚠
      expect(output).toContain('\u2717');
      expect(output).toContain('lore-id-present');
      expect(output).toContain(`${LORE_ID_KEY} trailer is missing`);
      expect(output).toContain('\u26A0');
      expect(output).toContain('Intent too long');
      expect(output).toContain('1 errors');
      expect(output).toContain('1 warnings');
    });

    it(`should use commit hash prefix when no ${LORE_ID_KEY}`, () => {
      const data: FormattableValidationResult = {
        summary: { errors: 1, warnings: 0, commitsChecked: 1 },
        results: [
          {
            commit: 'abc1234567890',
            id: null,
            valid: false,
            issues: [
              { severity: 'error', rule: 'lore-id-present', message: `Missing ${LORE_ID_KEY}` },
            ],
          },
        ],
        valid: false
      };

      const output = formatter.formatValidationResult(data);
      expect(output).toContain('abc12345');
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
      const targetAtom = makeAtom({ id: 'ccccdddd', intent: 'related change' });
      const data: FormattableTraceResult = {
        root,
        edges: [
          { from: 'aaaabbbb', to: 'ccccdddd', relationship: 'Related', targetAtom },
          { from: 'aaaabbbb', to: 'eeeeffff', relationship: 'Supersedes', targetAtom: null },
        ],
      };

      const output = formatter.formatTraceResult(data);
      expect(output).toContain('aaaabbbb');
      expect(output).toContain('\u251C\u2500\u2500');
      expect(output).toContain('[Related]');
      expect(output).toContain('ccccdddd');
      expect(output).toContain('related change');
      expect(output).toContain('\u2514\u2500\u2500');
      expect(output).toContain('[Supersedes]');
      expect(output).toContain('eeeeffff');
      expect(output).toContain('(unresolved)');
    });

    it('should use last-item connector for single edge', () => {
      const root = makeAtom({ id: 'aaaabbbb' });
      const data: FormattableTraceResult = {
        root,
        edges: [
          { from: 'aaaabbbb', to: 'ccccdddd', relationship: 'Depends-on', targetAtom: null },
        ],
      };

      const output = formatter.formatTraceResult(data);
      expect(output).toContain('\u2514\u2500\u2500');
      expect(output).not.toContain('\u251C\u2500\u2500');
    });
  });

  describe('formatDoctorResult', () => {
    it('should show check statuses with labels', () => {
      const data: FormattableDoctorResult = {
        checks: [
          { name: 'git-version', status: 'ok', message: 'Git 2.40+ detected', details: [] },
          { name: 'config', status: 'warning', message: 'No config found', details: ['Using defaults'] },
          { name: 'duplicates', status: 'error', message: `2 duplicate ${LORE_ID_KEY}s`, details: ['a1b2c3d4', 'e5f6a7b8'] },
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
      expect(output).toContain(`2 duplicate ${LORE_ID_KEY}s`);
      expect(output).toContain('1 errors');
      expect(output).toContain('1 warnings');
    });

    it('should show "all checks passed" when no issues', () => {
      const data: FormattableDoctorResult = {
        checks: [
          { name: 'git-version', status: 'ok', message: 'OK', details: [] },
        ],
        summary: { errors: 0, warnings: 0, info: 0 },
      };

      const output = formatter.formatDoctorResult(data);
      expect(output).toContain('all checks passed');
    });
  });

  describe('formatSuccess', () => {
    it('should return the message', () => {
      const output = formatter.formatSuccess('Commit created: a1b2c3d4');
      expect(output).toContain('Commit created: a1b2c3d4');
    });
  });

  describe('formatError', () => {
    it('should show error messages with severity', () => {
      const output = formatter.formatError(1, [
        { severity: 'error', message: 'Something went wrong' },
        { severity: 'warning', field: 'intent', message: 'Too long' },
      ]);

      expect(output).toContain('error');
      expect(output).toContain('Something went wrong');
      expect(output).toContain('warning');
      expect(output).toContain('[intent]');
      expect(output).toContain('Too long');
      expect(output).toContain('exit code 1');
    });

    it('should show each validation issue individually', () => {
      const output = formatter.formatError(1, [
        { severity: 'error', message: 'Required trailer "Assisted-by" is missing' },
        { severity: 'error', message: 'Required trailer "Ticket" is missing' },
        { severity: 'warning', message: 'Intent exceeds 72 characters' },
      ]);

      expect(output).toContain('Required trailer "Assisted-by" is missing');
      expect(output).toContain('Required trailer "Ticket" is missing');
      expect(output).toContain('Intent exceeds 72 characters');
    });

    it('should not show exit code when code is 0', () => {
      const output = formatter.formatError(0, [
        { severity: 'warning', message: 'Minor issue' },
      ]);

      expect(output).not.toContain('exit code');
    });
  });

  describe('color support', () => {
    it('should produce output with color disabled', () => {
      const noColor = new TextFormatter(registry, { color: false });
      const output = noColor.formatSuccess('OK');
      // With chalk level 0, no ANSI codes
      expect(output).not.toMatch(/\x1b\[/);
    });
  });
});
