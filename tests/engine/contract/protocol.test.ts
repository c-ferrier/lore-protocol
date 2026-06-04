import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { 
  TEST_PROTOCOL_DEFINITION, 
  TEST_ENGINE_CONFIG,
  TEST_ID_KEY,
  MOCK_CORE_TRAILERS,
  makeMockContext,
  makeProtocolRegistry,
} from '../../../src/engine/testing.js';

import { 
    isCoreTrailer, 
    getAuthorizedKeys 
} from '../../../src/engine/core/logic/protocols.js';
import { 
    claimsTrailers, 
    getDiscoveryPatterns, 
    getSearchPatterns 
} from '../../../src/engine/shell/git/protocol-query-adapter.js';
import { 
    authorizeKey, 
    ownsKey 
} from '../../../src/engine/core/logic/ownership.js';
import { 
    normalizeTrailers 
} from '../../../src/engine/core/logic/normalization.js';
import { validateTrailer } from '../../../src/engine/core/logic/validation.js';
import { TriggerParser } from '../../../src/engine/util/trigger-parser.js';

import { describe, it, expect } from 'vitest';

describe('Protocol Service', () => {

  it('should load baseline trailers by default', () => {
    const protocol = makeMockContext({ name: 'BaselineTest' });
    const keys = getAuthorizedKeys(protocol);
    
    expect(keys).toContain(TEST_ID_KEY);
    expect(keys).not.toContain('Constraint');
  });

  it('should merge custom definitions into the protocol', () => {
    const protocol = makeMockContext({ 
        name: 'MergeTest',
        trailers: {
            'Team': { description: 'The team responsible', multivalue: false, validation: 'none' }
        }
    });
    const def = protocol.trailers.get('Team');
    
    expect(def).toBeDefined();
    expect(def?.description).toBe('The team responsible');
    expect(def?.isCore).toBe(false);
    expect(isCoreTrailer('Team', protocol)).toBe(false);
  });

  it('should identify configured custom trailers as non-core even if they are in core-definitions', () => {
    const protocol = makeMockContext({ 
        name: 'CoreTest',
        trailers: {
            'Constraint': { description: 'User override', isCore: true }
        }
    });
    
    expect(isCoreTrailer('Constraint', protocol)).toBe(true);
    expect(protocol.trailers.get('Constraint')?.description).toBe('User override');
  });

  it('should authorize any key in permissive mode', () => {
    const protocol = makeMockContext({ name: 'PermissiveTest', strict: false, permissive: true });
    expect(authorizeKey('Random-Key', protocol)).toBe('Random-Key');
  });

  it('should not authorize unknown keys in strict mode', () => {
    const protocol = makeMockContext({ name: 'StrictAuthTest', strict: true, permissive: false });
    expect(authorizeKey('Unknown', protocol)).toBeNull();
  });

  it('should sort authorized keys based on prompt order', () => {
    const protocol = makeMockContext({
      name: 'SortTest',
      trailers: {
        'Z': { description: '', prompt: { order: 10 } } as any,
        'A': { description: '', prompt: { order: 5 } } as any
      }
    });
    const keys = getAuthorizedKeys(protocol);
    // Mock-id has order 0
    expect(keys[0]).toBe(TEST_ID_KEY);
    expect(keys[1]).toBe('A');
    expect(keys[2]).toBe('Z');
  });

  it('should default custom trailers to the end of the sort order', () => {
    const protocol = makeMockContext({ 
        name: 'OrderTest',
        trailers: { 'Custom': { description: 'D' } }
    });
    const keys = getAuthorizedKeys(protocol);
    expect(keys[keys.length - 1]).toBe('Custom');
  });

  describe('Case-Insensitive Normalization', () => {
    it('should normalize core keys regardless of input casing', () => {
      const protocol = makeMockContext({ 
        name: 'CaseTest',
        trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS } 
      });
      expect(authorizeKey('confidence', protocol)).toBe('Confidence');
      expect(authorizeKey('CONFIDENCE', protocol)).toBe('Confidence');
    });

    it('should normalize custom definition keys', () => {
        const protocol = makeMockContext({ 
            name: 'CustomCaseTest',
            trailers: { 'Custom-Key': { description: 'D' } }
        });
        expect(authorizeKey('custom-key', protocol)).toBe('Custom-Key');
    });

    it('should preserve original casing for ad-hoc trailers in permissive mode', () => {
      const protocol = makeMockContext({ name: 'AdhocCaseTest', permissive: true, strict: false });
      expect(authorizeKey('New-Key', protocol)).toBe('New-Key');
    });

    it('should prioritize core casing over ad-hoc casing', () => {
        const protocol = makeMockContext({ 
            name: 'PriorityCaseTest',
            permissive: true,
            trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
        });
        expect(authorizeKey('confidence', protocol)).toBe('Confidence');
    });
  });

  describe('Required Unification', () => {
    it('should mark a trailer as required if set in definitions', () => {
      const protocol = makeMockContext({
        name: 'RequiredTest',
        trailers: { 'Must-Have': { description: '', required: true } } as any
      });
      expect(protocol.trailers.get('Must-Have')?.required).toBe(true);
    });
  });

  describe('Custom Overrides', () => {
    it('should allow custom definitions to override core trailer metadata (e.g. color)', () => {
      const overriddenProtocol = makeMockContext({
          ...TEST_PROTOCOL_DEFINITION,
          name: 'OverrideTest',
          trailers: {
              ...TEST_PROTOCOL_DEFINITION.trailers,
              'Confidence': { ...MOCK_CORE_TRAILERS.Confidence, description: 'New Desc', ui: { color: 'red' } } as any
          }
      });
      
      const def = overriddenProtocol.trailers.get('Confidence');
      expect(def?.description).toBe('New Desc');
      expect(def?.ui?.color).toBe('red');
    });
  });

  describe('Discovery & Claims', () => {
    it('should claim a commit with its identity key', () => {
        const protocol = makeMockContext({ name: 'ClaimTest' });
        expect(claimsTrailers(`${TEST_ID_KEY}: a1b2c3d4`, protocol)).toBe(true);
    });

    it('should not claim a commit without its identity key', () => {
        const protocol = makeMockContext({ name: 'NoClaimTest' });
        expect(claimsTrailers('Other: value', protocol)).toBe(false);
    });

    it('should provide discovery patterns', () => {
        const protocol = makeMockContext({ name: 'DiscoveryTest' });
        expect(getDiscoveryPatterns(protocol)).toEqual([`^${TEST_ID_KEY}: [0-9a-f]{8}`]);
    });
  });

  describe('parse', () => {
    it('should parse and normalize authorized trailers', () => {
      const protocol = makeMockContext({ 
        name: 'ParseTest',
        trailers: { 
            [TEST_ID_KEY]: TEST_PROTOCOL_DEFINITION.trailers[TEST_ID_KEY],
            'Confidence': MOCK_CORE_TRAILERS.Confidence 
        } 
      });
      const rawMap = TriggerParser.parseTrailers(`Mock-id: a1b2c3d4\nConfidence: high`);
      const state = normalizeTrailers(rawMap, protocol);
      expect(state.trailers['Mock-id']).toEqual(['a1b2c3d4']);
      expect(state.trailers.Confidence).toEqual(['high']);
    });

    it('should move unauthorized trailers to unauthorized bucket in strict mode', () => {
      const protocol = makeMockContext({ 
        name: 'StrictTest',
        strict: true, 
        permissive: false 
      });
      const rawMap = TriggerParser.parseTrailers(`Mock-id: a1b2c3d4\nTypo: value`);
      const state = normalizeTrailers(rawMap, protocol);
      expect(state.trailers.Typo).toBeUndefined();
      expect(state.unauthorized.Typo).toEqual(['value']);
    });

    it('should parse all enum values during normalization', () => {
        const protocol = makeMockContext({ 
            name: 'EnumTest',
            trailers: { 'Confidence': MOCK_CORE_TRAILERS.Confidence } 
        });
        const rawMap = TriggerParser.parseTrailers('Confidence: low\nConfidence: high');
        const state = normalizeTrailers(rawMap, protocol);
        expect(state.trailers.Confidence).toEqual(['low', 'high']);
    });

    describe('normalize()', () => {
        it('should categorize a raw map into authorized and unauthorized buckets', () => {
            const protocol = makeMockContext({ 
                name: 'NormalizeTest',
                permissive: false,
                trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
            });
            const raw = {
                [TEST_ID_KEY]: ['a1b2c3d4'],
                'Confidence': ['high'],
                'Typo-Key': ['junk']
            };

            const state = normalizeTrailers(raw, protocol);
            expect(state.trailers[TEST_ID_KEY]).toEqual(['a1b2c3d4']);
            expect(state.trailers.Confidence).toEqual(['high']);
            expect(state.unauthorized['Typo-Key']).toEqual(['junk']);
        });

        it('should ignore root trailers in namespaced protocols (Strict Isolation)', () => {
            const nsProtocol = makeMockContext({
                name: 'Project',
                namespace: 'Project',
                identityKey: 'Id',
                trailers: { Id: { description: '', multivalue: false, validation: 'none' } },
                permissive: false
            });

            const raw = {
                'Id': ['12345'],
                'Team': ['Backend']
            };

            const state = normalizeTrailers(raw, nsProtocol);
            // STRICT ISOLATION: Namespaced protocols ignore Root level.
            expect(state.trailers.Id).toBeUndefined();
            expect(state.unauthorized.Team).toBeUndefined();
        });

        it('should identify global namespaced trailers (un-bucketed)', () => {
            const nsProtocol = makeMockContext({
                name: 'ProjectSub',
                namespace: 'Project',
                identityKey: 'Id',
                trailers: { Id: { description: '', multivalue: false, validation: 'none' } },
                permissive: false
            });

            const raw = {
                'Project': ['Id: 12345', 'Team: Backend'],
                'Other': ['Junk']
            };

            const state = normalizeTrailers(raw, nsProtocol);
            expect(state.trailers.Id).toEqual(['12345']);
            expect(state.unauthorized.Team).toEqual(['Backend']);
            expect(state.trailers.Other).toBeUndefined();
        });
    });

    it('should handle multi-value trailers', () => {
      const protocol = makeMockContext({ 
        name: 'MultiValueTest',
        trailers: { 
            [TEST_ID_KEY]: TEST_PROTOCOL_DEFINITION.trailers[TEST_ID_KEY],
            'Constraint': MOCK_CORE_TRAILERS.Constraint 
        } 
      });
      const rawMap = TriggerParser.parseTrailers(`Mock-id: a1b2c3d4\nConstraint: c1\nConstraint: c2`);
      const state = normalizeTrailers(rawMap, protocol);
      expect(state.trailers.Constraint).toEqual(['c1', 'c2']);
    });

    it('should handle continuation lines via its internal parser', () => {
        const protocol = makeMockContext({ 
            name: 'ContinuationTest',
            trailers: { 
                [TEST_ID_KEY]: TEST_PROTOCOL_DEFINITION.trailers[TEST_ID_KEY],
                'Constraint': MOCK_CORE_TRAILERS.Constraint 
            } 
        });
        const rawMap = TriggerParser.parseTrailers('Mock-id: a1b2c3d4\nConstraint: Line 1\n  line 2');
        const state = normalizeTrailers(rawMap, protocol);
        expect(state.trailers.Constraint).toEqual(['Line 1\n  line 2']);
    });

    describe('Hierarchical Namespacing', () => {
      it('should own exactly its namespace key', () => {
          const nsProtocol = makeMockContext({
              name: 'ProjectOwn',
              namespace: 'Project',
              identityKey: 'Id',
              trailers: { Id: { description: '' } }
          });
          expect(ownsKey('Project', nsProtocol)).toBe(true);
          
          // STRICT ISOLATION: Namespaced protocols don't own root trailers.
          expect(ownsKey('Id', nsProtocol)).toBe(false);
      });

      it('should unpack nested colons during parsing', () => {
          const nsProtocol = makeMockContext({
              name: 'ProjectUnpack',
              namespace: 'Project',
              trailers: { 'Team': { description: 'T' } }
          });
          const rawMap = TriggerParser.parseTrailers('Project: Team: Backend');
          const state = normalizeTrailers(rawMap, nsProtocol);
          expect(state.trailers.Team).toEqual(['Backend']);
      });

      it('should track typos in namespaced trailers as unauthorized', () => {
          const nsProtocol = makeMockContext({
              name: 'ProjectTypo',
              namespace: 'Project',
              trailers: { 'Team': { description: 'T' } },
              permissive: false
          });
          const rawMap = TriggerParser.parseTrailers('Project: Tream: typo'); // Typo in nested key
          const state = normalizeTrailers(rawMap, nsProtocol);
          expect(state.unauthorized.Tream).toEqual(['typo']);
      });

      it('should provide namespaced discovery pattern', () => {
          const nsProtocol = makeMockContext({ name: 'ProjectPattern', namespace: 'Project' });
          expect(getDiscoveryPatterns(nsProtocol)).toEqual(['^Project:']);
      });

      it('should provide namespaced search patterns', () => {
          const nsProtocol = makeMockContext({ name: 'ProjectSearch', namespace: 'Project', trailers: { 'T': { description: 'T' } } as any });
          const patterns = getSearchPatterns([{ protocol: null, key: 'T', op: 'eq', value: 'v' }], nsProtocol);
          expect(patterns).toEqual([['^Project: T: v']]);
      });
    });

    describe('Ownership & Claims', () => {
      it('should own its identity key', () => {
        const protocol = makeMockContext({ name: 'IdOwnTest', identityKey: 'ID' });
        expect(ownsKey('ID', protocol)).toBe(true);
      });

      it('should own its configured trailers', () => {
        const protocol = makeMockContext({ 
            name: 'ConfiguredOwnTest',
            trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS } 
        });
        expect(ownsKey('Confidence', protocol)).toBe(true);
      });

      it('should own configured custom trailers', () => {
        const protocol = makeMockContext({ 
            name: 'CustomOwnTest',
            trailers: { 'Custom': { description: '' } }
        });
        expect(ownsKey('Custom', protocol)).toBe(true);
      });

      it('should not own unregistered trailers', () => {
        const protocol = makeMockContext({ name: 'UnregisteredOwnTest' });
        expect(ownsKey('Unknown', protocol)).toBe(false);
      });

      describe('parse with claim hierarchy', () => {
          it('should ingest owned trailers even if not in unclaimedKeys', () => {
              const protocol = makeMockContext({ 
                  name: 'OwnedClaimTest',
                  trailers: { 'Owned': { description: 'D' } } as any 
              });
              const rawMap = TriggerParser.parseTrailers('Owned: value');
              // Even if 'Owned' is not in unclaimed, we take it because we OWN it in our schema.
              const result = normalizeTrailers(rawMap, protocol, new Set());
              expect(result.trailers.Owned).toEqual(['value']);
          });

          it('should ingest unowned trailers only if permissive AND unclaimed', () => {
              const permissive = makeMockContext({ name: 'PermissiveClaimTest', permissive: true });
              const rawMap = TriggerParser.parseTrailers('Adhoc: value');
              // Passing an empty set means 'Adhoc' is UNCLAIMED
              const result = normalizeTrailers(rawMap, permissive, new Set());
              expect(result.trailers.Adhoc).toEqual(['value']);
          });

          it('should NOT ingest unowned trailers if not permissive', () => {
              const strict = makeMockContext({ name: 'StrictClaimTest', permissive: false });
              const rawMap = TriggerParser.parseTrailers('Adhoc: value');
              const result = normalizeTrailers(rawMap, strict, new Set());
              expect(result.trailers.Adhoc).toBeUndefined();
              expect(result.unauthorized.Adhoc).toEqual(['value']);
          });
      });
    });

    describe('validateTrailer', () => {
      const protocol = makeMockContext({ 
          name: 'ValidateTest',
          trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS } 
      });

      it('should validate enum values correctly', () => {
        expect(validateTrailer(protocol, 'Confidence', 'high').valid).toBe(true);
        expect(validateTrailer(protocol, 'Confidence', 'junk').valid).toBe(false);
      });

      it('should validate regex patterns correctly', () => {
        expect(validateTrailer(protocol, TEST_ID_KEY, 'a1b2c3d4').valid).toBe(true);
        expect(validateTrailer(protocol, TEST_ID_KEY, 'not-hex').valid).toBe(false);
      });

      it('should handle unresolvable cross-protocol references without a registry', () => {
        const result = validateTrailer(protocol, 'Related', 'other/abc');
        expect(result.valid).toBe(false);
        expect(result.rule).toBe('unknown-protocol-prefix');
      });

      it('should handle unknown protocol prefixes with a linked registry', () => {
        const registry = makeProtocolRegistry([protocol as any]);
        const result = validateTrailer(protocol, 'Related', 'other/abc', registry);
        expect(result.valid).toBe(false);
        expect(result.rule).toBe('unknown-protocol-prefix');
      });

      it('should treat self-prefixed references as local even without a registry', () => {
        const result = validateTrailer(protocol, 'Related', 'validatetest/a1b2c3d4');
        expect(result.valid).toBe(true);
      });

      it('should return specific id-format rule when identity key fails pattern', () => {
          const result = validateTrailer(protocol, TEST_ID_KEY, 'not-hex');
          expect(result.rule).toBe('validatetest-id-format');
      });

      it('should successfully validate a cross-protocol reference when registry is linked', () => {
        const otherProtocol = makeMockContext({ 
            name: 'Other', 
            namespace: 'Other', 
            identityKey: 'Other-id', 
            trailers: {} 
        });
        const registry = makeProtocolRegistry([protocol as any, otherProtocol as any]);
        
        const result = validateTrailer(protocol, 'Related', 'other/abc', registry);
        expect(result.valid).toBe(true);
      });

      it('should return valid for unknown trailers in permissive mode', () => {
          const permissive = makeMockContext({ name: 'PermissiveValidateTest', permissive: true });
          expect(validateTrailer(permissive, 'Random', 'any').valid).toBe(true);
      });

      it('should enforce boundary rules (crossProtocol: false) autonomously', () => {
          const localOnly = makeMockContext({
              name: 'BoundaryTest',
              trailers: { 'Internal': { description: '', validation: 'reference', crossProtocol: false } } as any
          });
          expect(validateTrailer(localOnly, 'Internal', 'other/abc').valid).toBe(false);
          expect(validateTrailer(localOnly, 'Internal', 'abc12345').valid).toBe(true);
      });
    });
  });
});
