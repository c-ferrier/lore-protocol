import { ActiveProtocol } from '../../../src/engine/core/models/active-protocol.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { 
  TEST_PROTOCOL_DEFINITION, 
  TEST_ENGINE_CONFIG,
  TEST_ID_KEY,
  MOCK_CORE_TRAILERS,
  makeProtocol,
  makeProtocolRegistry,
  makeTrailers
} from '../../../src/engine/testing.js';

import { 
    isCoreTrailer, 
    getAuthorizedKeys 
} from '../../../src/engine/core/logic/protocols.js';
import { describe, it, expect, vi } from 'vitest';

describe('Protocol Service', () => {

  it('should load baseline trailers by default', () => {
    const protocol = makeProtocol({ name: 'BaselineTest' });
    const keys = getAuthorizedKeys(protocol);
    
    expect(keys).toContain(TEST_ID_KEY);
    expect(keys).not.toContain('Constraint');
  });

  it('should merge custom definitions into the protocol', () => {
    const config = {
      trailers: {
        'Team': { description: 'The team responsible', multivalue: false, validation: 'none' }
      }
    };
    const protocol = makeProtocol({ name: 'MergeTest' }, config as any);
    const def = protocol.trailers.get('Team');
    
    expect(def).toBeDefined();
    expect(def?.description).toBe('The team responsible');
    expect(def?.isCore).toBe(false);
    expect(isCoreTrailer('Team', protocol)).toBe(false);
  });

  it('should identify configured custom trailers as non-core even if they are in core-definitions', () => {
    const config = {
      trailers: {
        'Constraint': { description: 'User override', isCore: true }
      }
    };
    const protocol = makeProtocol({ name: 'CoreTest' }, config as any);
    
    expect(isCoreTrailer('Constraint', protocol)).toBe(true);
    expect(protocol.trailers.get('Constraint')?.description).toBe('User override');
  });

  it('should authorize any key in permissive mode', () => {
    const config = {
      strict: false, 
      permissive: true,
      trailers: {}
    };
    const protocol = makeProtocol({ name: 'PermissiveTest' }, config as any);
    
    expect(protocol.authorize('Random-Key')).toBe('Random-Key');
  });

  it('should not authorize unknown keys in strict mode', () => {
    const protocol = makeProtocol({ name: 'StrictAuthTest', strict: true, permissive: false });
    expect(protocol.authorize('Unknown')).toBeNull();
  });

  it('should sort authorized keys based on prompt order', () => {
    const protocol = makeProtocol({
      name: 'SortTest',
      trailers: {
        'Z': { description: '', prompt: { order: 10 } } as any,
        'A': { description: '', prompt: { order: 5 } } as any
      }
    });
    const keys = getAuthorizedKeys(protocol);
    expect(keys[0]).toBe('A');
    expect(keys[1]).toBe('Z');
  });

  it('should default custom trailers to the end of the sort order', () => {
    const protocol = makeProtocol({ name: 'OrderTest' }, {
      trailers: { 'Custom': { description: 'D' } }
    } as any);
    const keys = getAuthorizedKeys(protocol);
    expect(keys[keys.length - 1]).toBe('Custom');
  });

  describe('Case-Insensitive Normalization', () => {
    it('should normalize core keys regardless of input casing', () => {
      const protocol = makeProtocol({ 
        name: 'CaseTest',
        trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS } 
      });
      expect(protocol.authorize('confidence')).toBe('Confidence');
      expect(protocol.authorize('CONFIDENCE')).toBe('Confidence');
    });

    it('should normalize custom definition keys', () => {
        const protocol = makeProtocol({ name: 'CustomCaseTest' }, {
            trailers: { 'Custom-Key': { description: 'D' } }
        } as any);
        expect(protocol.authorize('custom-key')).toBe('Custom-Key');
    });

    it('should preserve original casing for ad-hoc trailers in permissive mode', () => {
      const protocol = makeProtocol({ name: 'AdhocCaseTest', permissive: true });
      expect(protocol.authorize('New-Key')).toBe('New-Key');
    });

    it('should prioritize core casing over ad-hoc casing', () => {
        const protocol = makeProtocol({ 
            name: 'PriorityCaseTest',
            permissive: true,
            trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
        });
        // 'confidence' is core, so it should be mapped to 'Confidence' even if we allow ad-hoc
        expect(protocol.authorize('confidence')).toBe('Confidence');
    });
  });

  describe('Required Unification', () => {
    it('should mark a trailer as required if set in definitions', () => {
      const protocol = makeProtocol({
        name: 'RequiredTest',
        trailers: { 'Must-Have': { description: '', required: true } } as any
      });
      expect(protocol.trailers.get('Must-Have')?.required).toBe(true);
    });
  });

  describe('Custom Overrides', () => {
    it('should allow custom definitions to override core trailer metadata (e.g. color)', () => {
      const protocol = makeProtocol({ 
        name: 'OverrideTest',
        trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS } 
      }, {
        trailers: {
          'Confidence': { description: 'New Desc', ui: { color: 'red' } }
        }
      } as any);
      
      const def = protocol.trailers.get('Confidence');
      expect(def?.description).toBe('New Desc');
      expect(def?.ui?.color).toBe('red');
    });
  });

  describe('Discovery & Claims', () => {
    it('should claim a commit with its identity key', () => {
        const protocol = makeProtocol({ name: 'ClaimTest' });
        expect(protocol.claims(`${TEST_ID_KEY}: a1b2c3d4`)).toBe(true);
    });

    it('should not claim a commit without its identity key', () => {
        const protocol = makeProtocol({ name: 'NoClaimTest' });
        expect(protocol.claims('Other: value')).toBe(false);
    });

    it('should provide discovery patterns', () => {
        const protocol = makeProtocol({ name: 'DiscoveryTest' });
        expect(protocol.getDiscoveryPatterns()).toEqual([`^${TEST_ID_KEY}: [0-9a-f]{8}`]);
    });
  });

  describe('parse', () => {
    it('should parse and normalize authorized trailers', () => {
      const protocol = makeProtocol({ 
        name: 'ParseTest',
        trailers: { 
            [TEST_ID_KEY]: TEST_PROTOCOL_DEFINITION.trailers[TEST_ID_KEY],
            'Confidence': MOCK_CORE_TRAILERS.Confidence 
        } 
      });
      const raw = `Mock-id: a1b2c3d4\nConfidence: high`;
      const state = protocol.parse(raw);
      expect(state.trailers['Mock-id']).toEqual(['a1b2c3d4']);
      expect(state.trailers.Confidence).toEqual(['high']);
    });

    it('should move unauthorized trailers to unauthorized bucket in strict mode', () => {
      const protocol = makeProtocol({ 
        name: 'StrictTest',
        strict: true, 
        permissive: false 
      });
      const raw = `Mock-id: a1b2c3d4\nTypo: value`;
      const state = protocol.parse(raw);
      expect(state.trailers.Typo).toBeUndefined();
      expect(state.unauthorized.Typo).toEqual(['value']);
    });

    it('should parse all enum values during normalization', () => {
        const protocol = makeProtocol({ 
            name: 'EnumTest',
            trailers: { 'Confidence': MOCK_CORE_TRAILERS.Confidence } 
        });
        const raw = 'Confidence: low\nConfidence: high';
        const state = protocol.parse(raw);
        expect(state.trailers.Confidence).toEqual(['low', 'high']);
    });

    describe('normalize()', () => {
        it('should categorize a raw map into authorized and unauthorized buckets', () => {
            const protocol = makeProtocol({ 
                name: 'NormalizeTest',
                permissive: false,
                trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
            });
            const raw = {
                [TEST_ID_KEY]: ['a1b2c3d4'],
                'Confidence': ['high'],
                'Typo-Key': ['junk']
            };

            const state = protocol.normalize(raw);
            expect(state.trailers[TEST_ID_KEY]).toEqual(['a1b2c3d4']);
            expect(state.trailers.Confidence).toEqual(['high']);
            expect(state.unauthorized['Typo-Key']).toEqual(['junk']);
        });

        it('should ignore root trailers in namespaced protocols (Strict Isolation)', () => {
            const nsProtocol = makeProtocol({
                name: 'Project',
                namespace: 'Project',
                identityKey: 'Id',
                trailers: { Id: { description: '', multivalue: false, validation: 'none' } }
            }, { permissive: false });

            const raw = {
                'Id': ['12345'],
                'Team': ['Backend']
            };

            const state = nsProtocol.normalize(raw);
            // STRICT ISOLATION: Namespaced protocols ignore Root level.
            expect(state.trailers.Id).toBeUndefined();
            expect(state.unauthorized.Team).toBeUndefined();
        });

        it('should identify global namespaced trailers (un-bucketed)', () => {
            const nsProtocol = makeProtocol({
                name: 'ProjectSub',
                namespace: 'Project',
                identityKey: 'Id',
                trailers: { Id: { description: '', multivalue: false, validation: 'none' } }
            }, { permissive: false });

            const raw = {
                'Project': ['Id: 12345', 'Team: Backend'],
                'Other': ['Junk']
            };

            const state = nsProtocol.normalize(raw);
            expect(state.trailers.Id).toEqual(['12345']);
            expect(state.unauthorized.Team).toEqual(['Backend']);
            expect(state.trailers.Other).toBeUndefined();
        });
    });

    it('should handle multi-value trailers', () => {
      const protocol = makeProtocol({ 
        name: 'MultiValueTest',
        trailers: { 
            [TEST_ID_KEY]: TEST_PROTOCOL_DEFINITION.trailers[TEST_ID_KEY],
            'Constraint': MOCK_CORE_TRAILERS.Constraint 
        } 
      });
      const raw = `Mock-id: a1b2c3d4\nConstraint: c1\nConstraint: c2`;
      const state = protocol.parse(raw);
      expect(state.trailers.Constraint).toEqual(['c1', 'c2']);
    });

    it('should handle continuation lines via its internal parser', () => {
        const protocol = makeProtocol({ 
            name: 'ContinuationTest',
            trailers: { 
                [TEST_ID_KEY]: TEST_PROTOCOL_DEFINITION.trailers[TEST_ID_KEY],
                'Constraint': MOCK_CORE_TRAILERS.Constraint 
            } 
        });
        const raw = 'Mock-id: a1b2c3d4\nConstraint: Line 1\n  line 2';
        const state = protocol.parse(raw);
        expect(state.trailers.Constraint).toEqual(['Line 1\n  line 2']);
    });

    describe('Hierarchical Namespacing', () => {
      it('should own exactly its namespace key', () => {
          const nsProtocol = makeProtocol({
              name: 'ProjectOwn',
              namespace: 'Project',
              identityKey: 'Id',
              trailers: { Id: { description: '' } }
          }, { permissive: false });
          expect(nsProtocol.owns('Project')).toBe(true);
          expect(nsProtocol.owns('project')).toBe(true);
          
          // STRICT ISOLATION: Namespaced protocols don't own root trailers.
          expect(nsProtocol.owns('Id')).toBe(false);
      });

      it('should unpack nested colons during parsing', () => {
          const nsProtocol = makeProtocol({
              name: 'ProjectUnpack',
              namespace: 'Project',
              trailers: { 'Team': { description: 'T' } }
          });
          const raw = 'Project: Team: Backend';
          const state = nsProtocol.parse(raw);
          expect(state.trailers.Team).toEqual(['Backend']);
      });

      it('should track typos in namespaced trailers as unauthorized', () => {
          const nsProtocol = makeProtocol({
              name: 'ProjectTypo',
              namespace: 'Project',
              trailers: { 'Team': { description: 'T' } }
          }, { strict: true, permissive: false } as any);
          const raw = 'Project: Tream: typo'; // Typo in nested key
          const state = nsProtocol.parse(raw);
          expect(state.unauthorized.Tream).toEqual(['typo']);
      });

      it('should provide namespaced discovery pattern', () => {
          const nsProtocol = makeProtocol({ name: 'ProjectPattern', namespace: 'Project' });
          expect(nsProtocol.getDiscoveryPatterns()).toEqual(['^Project:']);
      });

      it('should provide namespaced search patterns', () => {
          const nsProtocol = makeProtocol({ name: 'ProjectSearch', namespace: 'Project', trailers: { 'T': { description: 'T' } } as any });
          const patterns = nsProtocol.getSearchPatterns([{ protocol: null, key: 'T', op: 'eq', value: 'v' }]);
          expect(patterns).toEqual([['^Project: T: v']]);
      });
    });

    describe('Ownership & Claims', () => {
      it('should own its identity key', () => {
        const protocol = makeProtocol({ name: 'IdOwnTest', identityKey: 'ID' });
        expect(protocol.owns('ID')).toBe(true);
      });

      it('should own its configured trailers', () => {
        const protocol = makeProtocol({ 
            name: 'ConfiguredOwnTest',
            trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS } 
        });
        expect(protocol.owns('Confidence')).toBe(true);
      });

      it('should own configured custom trailers', () => {
        const protocol = makeProtocol({ name: 'CustomOwnTest' }, {
            trailers: { 'Custom': { description: '' } }
        } as any);
        expect(protocol.owns('Custom')).toBe(true);
      });

      it('should not own unregistered trailers', () => {
        const protocol = makeProtocol({ name: 'UnregisteredOwnTest' });
        expect(protocol.owns('Unknown')).toBe(false);
      });

      describe('parse with claim hierarchy', () => {
          it('should ingest owned trailers even if not in unclaimedKeys', () => {
              const protocol = makeProtocol({ 
                  name: 'OwnedClaimTest',
                  trailers: { 'Owned': { description: 'D' } } as any 
              });
              const raw = 'Owned: value';
              // Even if 'Owned' is not in unclaimed, we take it because we OWN it in our schema.
              const result = protocol.parse(raw, new Set());
              expect(result.trailers.Owned).toEqual(['value']);
          });

          it('should ingest unowned trailers only if permissive AND unclaimed', () => {
              const permissive = makeProtocol({ name: 'PermissiveClaimTest', permissive: true });
              const raw = 'Adhoc: value';
              // Passing an empty set means 'Adhoc' is UNCLAIMED
              const result = permissive.parse(raw, new Set());
              expect(result.trailers.Adhoc).toEqual(['value']);
          });

          it('should NOT ingest unowned trailers if not permissive', () => {
              const strict = makeProtocol({ name: 'StrictClaimTest', permissive: false });
              const raw = 'Adhoc: value';
              const result = strict.parse(raw, new Set());
              expect(result.trailers.Adhoc).toBeUndefined();
              expect(result.unauthorized.Adhoc).toEqual(['value']);
          });
      });
    });

    describe('validateTrailer', () => {
      const protocol = makeProtocol({ 
          name: 'ValidateTest',
          trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS } 
      });

      it('should validate enum values correctly', () => {
        expect(protocol.validateTrailer('Confidence', 'high').valid).toBe(true);
        expect(protocol.validateTrailer('Confidence', 'junk').valid).toBe(false);
      });

      it('should validate regex patterns correctly', () => {
        expect(protocol.validateTrailer(TEST_ID_KEY, 'a1b2c3d4').valid).toBe(true);
        expect(protocol.validateTrailer(TEST_ID_KEY, 'not-hex').valid).toBe(false);
      });

      it('should handle unresolvable cross-protocol references without a registry', () => {
        const result = protocol.validateTrailer('Related', 'other/abc');
        expect(result.valid).toBe(false);
        expect(result.rule).toBe('unknown-protocol-prefix');
      });

      it('should handle unknown protocol prefixes with a linked registry', () => {
        const registry = makeProtocolRegistry([protocol]);
        const result = protocol.validateTrailer('Related', 'other/abc', registry);
        expect(result.valid).toBe(false);
        expect(result.rule).toBe('unknown-protocol-prefix');
      });

      it('should treat self-prefixed references as local even without a registry', () => {
        const result = protocol.validateTrailer('Related', 'validatetest/a1b2c3d4');
        expect(result.valid).toBe(true);
      });

      it('should return specific id-format rule when identity key fails pattern', () => {
          const result = protocol.validateTrailer(TEST_ID_KEY, 'not-hex');
          expect(result.rule).toBe('validatetest-id-format');
      });

      it('should successfully validate a cross-protocol reference when registry is linked', () => {
        const otherProtocol = makeProtocol({ 
            name: 'Other', 
            namespace: 'Other', 
            identityKey: 'Other-id', 
            trailers: {} 
        }, { permissive: false });
        const registry = makeProtocolRegistry([protocol, otherProtocol]);
        
        const result = protocol.validateTrailer('Related', 'other/abc', registry);
        expect(result.valid).toBe(true);
      });

      it('should return valid for unknown trailers in permissive mode', () => {
          const permissive = makeProtocol({ name: 'PermissiveValidateTest', permissive: true });
          expect(permissive.validateTrailer('Random', 'any').valid).toBe(true);
      });

      it('should enforce boundary rules (crossProtocol: false) autonomously', () => {
          const localOnly = makeProtocol({
              name: 'BoundaryTest',
              trailers: { 'Internal': { description: '', validation: 'reference', crossProtocol: false } } as any
          });
          expect(localOnly.validateTrailer('Internal', 'other/abc').valid).toBe(false);
          expect(localOnly.validateTrailer('Internal', 'abc12345').valid).toBe(true);
      });
    });
  });
});
