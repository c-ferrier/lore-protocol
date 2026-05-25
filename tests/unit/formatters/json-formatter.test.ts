import { describe, it, expect, beforeEach } from 'vitest';
import { JsonFormatter } from '../../../src/engine/formatters/json-formatter.js';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';
import { LORE_DEFAULT_CONFIG } from '../../../src/lore/defaults.js';
import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
} from '../../../src/engine/types/output.js';
import type { Atom, Trailers, SupersessionStatus } from '../../../src/engine/types/domain.js';

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
  let trailers = (overrides as any).trailers ?? makeTrailers();
  
  const id = overrides.id ?? (overrides as any).id ?? (trailers[LORE_ID_KEY]?.[0] || 'a1b2c3d4');
  
  if ((trailers[LORE_ID_KEY] || [])[0] !== id) {
    trailers = { ...trailers, [LORE_ID_KEY]: [id] } as any;
  }

  const base: Atom = {
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
  };

  return { ...base, ...overrides };
}

describe('JsonFormatter', () => {
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
    it('should produce valid JSON with top-level engine version', () => {
      const atom = makeAtom();
      const data: FormattableQueryResult = {
        result: {
          command: 'context',
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
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.version).toBe('1.0');
      expect(parsed.command).toBe('context');
    });

    it('should use snake_case field names and include protocols map', () => {
      const atom = makeAtom();
      const data: FormattableQueryResult = {
        result: {
          command: 'context',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: {
            totalAtoms: 5,
            filteredAtoms: 1,
            oldest: atom.date,
            newest: atom.date,
          },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.meta.total_atoms).toBe(5);
      expect(parsed.meta.filtered_atoms).toBe(1);
      expect(parsed.results[0].protocols.lore.lore_id).toBe('a1b2c3d4');
      expect(parsed.results[0].protocols.lore.lore_version).toBe('1.0');
      expect(parsed.results[0].commit).toBe('abc1234567890');
      expect(parsed.results[0].files_changed).toEqual(['src/auth.ts']);
    });

    it('should format dates as ISO strings', () => {
      const atom = makeAtom({ date: new Date('2025-06-15T14:30:00Z') });
      const data: FormattableQueryResult = {
        result: {
          command: 'context',
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
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.results[0].date).toBe('2025-06-15T14:30:00.000Z');
      expect(parsed.meta.oldest).toBe('2025-06-15T14:30:00.000Z');
    });

    it('should include supersession status', () => {
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
      const parsed = JSON.parse(output);

      expect(parsed.results[0].superseded).toBe(true);
      expect(parsed.results[0].superseded_by).toBe('e5f6a7b8');
    });

    it('should include filtered trailers inside protocol object', () => {
      const atom = makeAtom({
        trailers: makeTrailers({
          Constraint: ['Must use OAuth2'],
          Confidence: ['high'],
          Rejected: ['Session tokens'],
        }),
      });

      const data: FormattableQueryResult = {
        result: {
          command: 'constraints',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map(),
        visibleTrailers: ['Constraint'],
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.results[0].protocols.lore.constraint).toEqual(['Must use OAuth2']);
      expect(parsed.results[0].protocols.lore.confidence).toBeUndefined();
    });

    it('should handle empty atoms list', () => {
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
      const parsed = JSON.parse(output);

      expect(parsed.results).toEqual([]);
      expect(parsed.meta.oldest).toBeNull();
      expect(parsed.meta.newest).toBeNull();
    });

    it('should convert trailer keys to snake_case', () => {
      const atom = makeAtom({
        trailers: makeTrailers({
          'Scope-risk': ['wide'],
          'Not-tested': ['edge cases'],
          'Depends-on': ['aabbccdd'],
        }),
      });

      const data: FormattableQueryResult = {
        result: {
          command: 'context',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      const lore = parsed.results[0].protocols.lore;
      expect(lore.scope_risk).toBe('wide');
      expect(lore.not_tested).toEqual(['edge cases']);
      expect(lore.depends_on).toEqual(['aabbccdd']);
    });

    it('should normalize custom trailers based on metadata in registry', () => {
      const localRegistry = new ProtocolRegistry();
      const config = {
        ...LORE_DEFAULT_CONFIG,
        trailers: {
          ...LORE_DEFAULT_CONFIG.trailers,
          definitions: {
            'Assisted-by': { description: 'A', multivalue: false, validation: 'none' as const },
            'Team': { description: 'T', multivalue: true, validation: 'none' as const },
          },
        },
      };
      const customProtocol = new Protocol(LoreProtocolDefinition, config);
      localRegistry.register(customProtocol);
      const customFormatter = new JsonFormatter(localRegistry);

      const atom = makeAtom({
        trailers: {
          ...makeTrailers(),
          'Assisted-by': ['Gemini'],
          'Team': ['Engineering', 'Product'],
          'Project': ['Lore'],
        },
      });

      const data: FormattableQueryResult = {
        result: {
          command: 'context',
          target: 'all',
          targetType: 'global',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = customFormatter.formatQueryResult(data);
      const parsed = JSON.parse(output);
      const lore = parsed.results[0].protocols.lore;

      expect(lore.assisted_by).toBe('Gemini');
      expect(lore.team).toEqual(['Engineering', 'Product']);
      expect(lore.project).toEqual(['Lore']);
    });

    it('should include rebranded structural keys inside protocols map when protocol name is changed', () => {
      const localRegistry = new ProtocolRegistry();
      const fredProtocol = new Protocol({
        ...LoreProtocolDefinition,
        name: 'Fred',
        version: '2.5',
        identityKey: 'Fred-id',
      }, LORE_DEFAULT_CONFIG);
      localRegistry.register(fredProtocol);

      const fredFormatter = new JsonFormatter(localRegistry);
      const trailers = makeTrailers({ 'Fred-id': ['fred1234'] });
      const atom: Atom = {
        ...makeAtom({ id: 'lore123', trailers }),
        protocols: new Map([
          ['fred', { name: 'Fred', version: '2.5', identityKey: 'Fred-id', trailers }]
        ])
      };

      const data: FormattableQueryResult = {
        result: {
          command: 'context',
          target: 'all',
          targetType: 'global',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = fredFormatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.results[0].protocols.fred).toHaveProperty('fred_id', 'fred1234');
      expect(parsed.results[0].protocols.fred).toHaveProperty('fred_version', '2.5');
    });

    it('should include the full protocols map for all interpretations in JSON output', () => {
      const fredTrailers = { 'Fred-id': ['fred1234'], Status: ['active'] };
      const baseAtom = makeAtom({ id: 'lore1234' });
      
      const atom: Atom = {
        ...baseAtom,
        protocols: new Map([
          ...baseAtom.protocols.entries(),
          ['fred', { name: 'Fred', version: '2.0', identityKey: 'Fred-id', trailers: fredTrailers as any }]
        ])
      };

      const data: FormattableQueryResult = {
        result: {
          command: 'search',
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

      expect(parsed.results[0].protocols).toBeDefined();
      expect(parsed.results[0].protocols.lore.lore_id).toBe('lore1234');
      expect(parsed.results[0].protocols.lore.lore_version).toBe('1.0');
      expect(parsed.results[0].protocols.fred.fred_id).toBe('fred1234');
      expect(parsed.results[0].protocols.fred.fred_version).toBe('2.0');
      expect(parsed.results[0].protocols.fred.status).toEqual(['active']);
    });

    it('should handle top-level metadata without primary bias', () => {
      const localRegistry = new ProtocolRegistry();
      const fredProtocol = new Protocol({
        ...LoreProtocolDefinition,
        name: 'Fred',
        version: '2.5',
        identityKey: 'Fred-id',
        namespace: 'Fred',
      }, LORE_DEFAULT_CONFIG);
      localRegistry.register(fredProtocol);

      const formatterNoRoot = new JsonFormatter(localRegistry);
      const trailers = { 'Fred-id': ['f1'] };
      const atom: Atom = {
        ...makeAtom({ id: 'l1', trailers }),
        protocols: new Map([
          ['fred', { name: 'Fred', version: '2.5', identityKey: 'Fred-id', trailers: trailers as any }]
        ])
      };

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
      const parsed = JSON.parse(output);

      expect(parsed.version).toBe('1.0'); // Engine version
      expect(parsed.results[0].protocols.fred.fred_id).toBe('f1');
      expect(parsed.results[0].protocols.fred.fred_version).toBe('2.5');
    });
  });

  describe('formatValidationResult', () => {
    it('should produce valid JSON with correct structure', () => {
      const data: FormattableValidationResult = {
        valid: true,
        summary: { errors: 0, warnings: 0, commitsChecked: 2 },
        results: [
          { commit: 'abc123', id: 'a1b2c3d4', valid: true, issues: [] },
          { commit: 'def456', id: 'e5f6a7b8', valid: true, issues: [] },
        ],
      };

      const output = formatter.formatValidationResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.version).toBe('1.0');
      expect(parsed.valid).toBe(true);
      expect(parsed.summary.commits_checked).toBe(2);
      expect(parsed.results).toHaveLength(2);
      expect(parsed.results[0].id).toBe('a1b2c3d4');
    });

    it('should include issues in results', () => {
      const data: FormattableValidationResult = {
        valid: false,
        summary: { errors: 1, warnings: 0, commitsChecked: 1 },
        results: [
          {
            commit: 'abc123',
            id: null,
            valid: false,
            issues: [
              { severity: 'error', rule: 'lore-id-present', message: `Missing ${LORE_ID_KEY}` },
            ],
          },
        ],
      };

      const output = formatter.formatValidationResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.results[0].id).toBeNull();
      expect(parsed.results[0].issues[0].severity).toBe('error');
      expect(parsed.results[0].issues[0].rule).toBe('lore-id-present');
    });
  });

  describe('formatStalenessResult', () => {
    it('should produce valid JSON with stale atoms', () => {
      const atom = makeAtom();
      const data: FormattableStalenessResult = {
        atoms: [{
          atom,
          reasons: [
            { signal: 'age', description: 'Too old' },
            { signal: 'low-confidence', description: 'Low confidence' },
          ],
        }],
      };

      const output = formatter.formatStalenessResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.version).toBe('1.0');
      expect(parsed.stale_atoms).toHaveLength(1);
      expect(parsed.stale_atoms[0].protocols.lore.lore_id).toBe('a1b2c3d4');
      expect(parsed.stale_atoms[0].protocols.lore.lore_version).toBe('1.0');
      expect(parsed.stale_atoms[0].date).toBe('2025-01-15T10:00:00.000Z');
      expect(parsed.stale_atoms[0].reasons).toEqual([
        { signal: 'age', description: 'Too old' },
        { signal: 'low-confidence', description: 'Low confidence' },
      ]);
    });
  });

  describe('formatTraceResult', () => {
    it('should produce valid JSON with root and edges', () => {
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
      const parsed = JSON.parse(output);

      expect(parsed.version).toBe('1.0');
      expect(parsed.root.protocols.lore.lore_id).toBe('aaaabbbb');
      expect(parsed.root.protocols.lore.lore_version).toBe('1.0');
      expect(parsed.edges).toHaveLength(2);
      expect(parsed.edges[0].resolved).toBe(true);
      expect(parsed.edges[0].target_atom.protocols.lore.lore_id).toBe('ccccdddd');
    });
  });

  describe('formatDoctorResult', () => {
    it('should produce valid JSON with checks and summary', () => {
      const data: FormattableDoctorResult = {
        checks: [
          { name: 'git-version', status: 'ok', message: 'Git 2.40+ detected', details: [] },
          { name: 'config', status: 'warning', message: 'No config found', details: ['Using defaults'] },
        ],
        summary: { errors: 0, warnings: 1, info: 0 },
      };

      const output = formatter.formatDoctorResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.version).toBe('1.0');
      expect(parsed.checks).toHaveLength(2);
      expect(parsed.summary.warnings).toBe(1);
    });
  });

  describe('formatSuccess', () => {
    it('should produce valid JSON with success flag', () => {
      const output = formatter.formatSuccess('Commit created', { 
        hash: 'hash123', 
        protocols: { 
          lore: { lore_id: 'a1b2c3d4', lore_version: '1.0' } 
        } 
      });
      const parsed = JSON.parse(output);

      expect(parsed.version).toBe('1.0');
      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe('Commit created');
      expect(parsed.protocols.lore.lore_id).toBe('a1b2c3d4');
    });
  });

  describe('formatError', () => {
    it('should produce valid JSON with error details', () => {
      const output = formatter.formatError(1, [
        { severity: 'error', message: 'Validation failed' },
      ]);
      const parsed = JSON.parse(output);

      expect(parsed.version).toBe('1.0');
      expect(parsed.error).toBe(true);
      expect(parsed.code).toBe(1);
    });
  });
});
