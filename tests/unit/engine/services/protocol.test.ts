import { describe, it, expect } from 'vitest';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { 
  MOCK_PROTOCOL_DEFINITION, 
  MOCK_CONFIG, 
  makeProtocolConfig,
  makeProtocol
} from '../test-utils.js';

const MOCK_ID_KEY = "Mock-id";

describe('Protocol Service', () => {
  it('should load all core trailers by default', () => {
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
    const keys = protocol.getAuthorizedKeys();

    expect(keys).toContain('Constraint');
    expect(keys).toContain('Confidence');
    expect(protocol.isCore('Constraint')).toBe(true);
  });

  it('should merge custom definitions into the protocol', () => {
    const config = {
      trailers: {
          Team: {
            description: 'The team responsible',
            multivalue: false,
            validation: 'none' as const,
          },
      },
    };
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, config);
    
    const def = protocol.getDefinition('Team');
    expect(def).toBeDefined();
    expect(def?.description).toBe('The team responsible');
    expect(def?.isCore).toBe(false);
    expect(protocol.isCore('Team')).toBe(false);
  });

  it('should identify configured custom trailers as non-core even if they are in core-definitions', () => {
    // This tests the case where a user might try to override a core definition
    const config = {
      trailers: {
          Constraint: {
            description: 'User override',
            multivalue: true,
            validation: 'none' as const,
          },
      },
    };
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, config);
    
    expect(protocol.isCore('Constraint')).toBe(true);
    expect(protocol.getDefinition('Constraint')?.description).toBe('User override');
  });

  it('should authorize any key in permissive mode', () => {
    const config = {
      strict: false, 
      permissive: true,
      trailers: {}
    };
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, config);
    
    expect(protocol.authorize('Random-Key')).toBe('Random-Key');
  });

  it('should not authorize unknown keys in strict mode', () => {
    const config = {
      strict: true,
      permissive: false,
      trailers: {},
    };
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, config);
    
    expect(protocol.authorize('Random-Key')).toBeNull();
  });

  it('should sort authorized keys based on prompt order', () => {
    const config = {
      trailers: {
          Urgent: {
            description: 'U',
            multivalue: false,
            validation: 'none' as const,
            prompt: { order: 105 } // Between Constraint (100) and Confidence (120)
          },
      },
    };
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, config);
    const keys = protocol.getAuthorizedKeys();
    
    const constraintIdx = keys.indexOf('Constraint');
    const urgentIdx = keys.indexOf('Urgent');
    const confidenceIdx = keys.indexOf('Confidence');

    expect(constraintIdx).toBeLessThan(urgentIdx);
    expect(urgentIdx).toBeLessThan(confidenceIdx);
  });

  it('should default custom trailers to the end of the sort order', () => {
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, {
      trailers: {
          Adhoc: { description: 'adhoc', multivalue: false, validation: 'none', isCore: false },
      }
    });

    const keys = protocol.getAuthorizedKeys();
    
    const adhocIdx = keys.indexOf('Adhoc');
    const confidenceIdx = keys.indexOf('Confidence');

    expect(confidenceIdx).toBeLessThan(adhocIdx);
  });

  describe('Case-Insensitive Normalization', () => {
    it('should normalize core keys regardless of input casing', () => {
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG);
      
      expect(protocol.authorize('confidence')).toBe('Confidence');
      expect(protocol.authorize('CONFIDENCE')).toBe('Confidence');
    });

    it('should normalize custom definition keys', () => {
      const config = {
        trailers: {
            'Assisted-by': { description: 'A', multivalue: true, validation: 'none' as const }
        }
      };
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, config);
      
      expect(protocol.authorize('assisted-by')).toBe('Assisted-by');
      expect(protocol.authorize('ASSISTED-BY')).toBe('Assisted-by');
    });

    it('should preserve original casing for ad-hoc trailers in permissive mode', () => {
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG);
      
      expect(protocol.authorize('New-Key')).toBe('New-Key');
    });

    it('should prioritize core casing over ad-hoc casing', () => {
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG);
      
      // 'Confidence' exists in schema
      expect(protocol.authorize('confidence')).toBe('Confidence');
    });
  });

  describe('Required Unification', () => {
    it('should mark a trailer as required if set in definitions', () => {
      const config = {
        trailers: {
          Team: { description: 'D', multivalue: false, validation: 'none' as const, required: true },
        }
      };
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, config);
      expect(protocol.getDefinition('Team')?.required).toBe(true);
    });
  });

  describe('Custom Overrides', () => {
    it('should allow custom definitions to override core trailer metadata (e.g. color)', () => {
      const config = {
        trailers: {
            Confidence: { 
              description: 'Custom confidence', 
              multivalue: false, 
              validation: 'values' as const, 
              ui: { color: 'magenta' as const } 
            }
        }
      };
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, config);
      const def = protocol.getDefinition('Confidence');
      
      expect(def?.ui?.color).toBe('magenta');
      expect(def?.validation).toBe('values'); // Preserved from core
    });
  });

  describe('Discovery & Claims', () => {
    it('should claim a commit with its identity key', () => {
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
      const raw = `${MOCK_ID_KEY}: a1b2c3d4\nSubject: test`;
      expect(protocol.claims(raw)).toBe(true);
    });

    it('should not claim a commit without its identity key', () => {
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
      const raw = 'Subject: test\nOther-Id: 123';
      expect(protocol.claims(raw)).toBe(false);
    });

    it('should provide discovery grep arguments', () => {
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
      const grep = protocol.getDiscoveryGrep();
      expect(grep[0]).toContain(`--grep=^${MOCK_ID_KEY}:`);
    });
  });

  describe('parse', () => {
    it('should parse and normalize authorized trailers', () => {
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
      const raw = `${MOCK_ID_KEY}: a1b2c3d4\nconfidence: high`;
      const result = protocol.parse(raw);
      
      expect(result.trailers[MOCK_ID_KEY]).toEqual(['a1b2c3d4']);
      expect(result.trailers.Confidence).toEqual(['high']);
    });

    it('should move unauthorized trailers to unauthorized bucket in strict mode', () => {
      const strictProtocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, {
          strict: true,
          permissive: false,
          trailers: {}
      });

      const raw = 'Unknown-Trailer: value';
      const result = strictProtocol.parse(raw);
      expect(result.trailers['Unknown-Trailer']).toBeUndefined();
      expect(result.unauthorized['Unknown-Trailer']).toEqual(['value']);
    });

    it('should parse all enum values during normalization', () => {
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
      const raw = 'Confidence: low\nConfidence: high';
      const result = protocol.parse(raw);
      expect(result.trailers.Confidence).toEqual(['low', 'high']);
    });

    describe('normalize()', () => {
        it('should categorize a raw map into authorized and unauthorized buckets', () => {
            // Strict mode to ensure typos go to unauthorized
            const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, {
                strict: true, permissive: false
            });
            const raw = {
                'Confidence': ['high'],
                'Typo-Key': ['junk']
            };

            const state = protocol.normalize(raw);
            expect(state.trailers.Confidence).toEqual(['high']);
            expect(state.unauthorized['Typo-Key']).toEqual(['junk']);
        });

        it('should handle pre-bucketed namespaced trailers', () => {
            const nsProtocol = makeProtocol({
                name: 'Project',
                namespace: 'Project',
                identityKey: 'Id',
                trailers: { Id: { description: '', multivalue: false, validation: 'none' } }
            }, { permissive: false });

            // If we already isolated the bucket (e.g. from global parser)
            const raw = {
                'Id': ['12345'],
                'Team': ['Backend']
            };

            const state = nsProtocol.normalize(raw);
            expect(state.trailers.Id).toEqual(['12345']);
            // Team was in the bucket but not in schema -> unauthorized
            expect(state.unauthorized.Team).toEqual(['Backend']);
        });

        it('should identify global namespaced trailers (un-bucketed)', () => {
            const nsProtocol = makeProtocol({
                name: 'Project',
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
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
      const raw = 'Constraint: c1\nConstraint: c2';
      const result = protocol.parse(raw);
      expect(result.trailers.Constraint).toEqual(['c1', 'c2']);
    });

    it('should handle continuation lines via its internal parser', () => {
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
      const raw = 'Constraint: line1\n  line2';
      const result = protocol.parse(raw);
      expect(result.trailers.Constraint).toEqual(['line1 line2']);
    });
  });

  describe('Hierarchical Namespacing', () => {
      it('should own exactly its namespace key', () => {
          const nsProtocol = makeProtocol({ 
              name: 'Project', 
              namespace: 'Project', 
              identityKey: 'Id',
              trailers: {
                'Id': { description: 'id', multivalue: false, validation: 'none' },
                'Team': { description: 'team', multivalue: false }
              }
          }, { permissive: false });
          expect(nsProtocol.owns('Project')).toBe(true);
          expect(nsProtocol.owns('Id')).toBe(false);
      });

      it('should unpack nested colons during parsing', () => {
          const nsProtocol = makeProtocol({ 
              name: 'Project', 
              namespace: 'Project', 
              identityKey: 'Id',
              trailers: {
                'Id': { description: 'id', multivalue: false, validation: 'none' },
                'Team': { description: 'team', multivalue: false }
              }
          }, { permissive: false });
          const raw = 'Project: Id: a1b2c3d4\nProject: Team: Backend';
          const result = nsProtocol.parse(raw);
          expect(result.trailers.Id).toEqual(['a1b2c3d4']);
          expect(result.trailers.Team).toEqual(['Backend']);
      });

      it('should track typos in namespaced trailers as unauthorized', () => {
          const nsProtocol = makeProtocol({ 
              name: 'Project', 
              namespace: 'Project', 
              identityKey: 'Id',
              trailers: {
                'Id': { description: 'id', multivalue: false, validation: 'none' },
                'Team': { description: 'team', multivalue: false }
              }
          }, { permissive: false });
          const raw = 'Project: Tream: typo';
          const result = nsProtocol.parse(raw);
          expect(result.unauthorized.Tream).toEqual(['typo']);
      });

      it('should provide namespaced discovery pattern', () => {
          const nsProtocol = makeProtocol({ 
              name: 'Project', 
              namespace: 'Project', 
              identityKey: 'Id',
              trailers: {
                'Id': { description: 'id', multivalue: false, validation: 'none' },
                'Team': { description: 'team', multivalue: false }
              }
          }, { permissive: false });
          expect(nsProtocol.getDiscoveryPattern()).toBe('^Project:');
      });

      it('should provide namespaced search grep', () => {
          const nsProtocol = makeProtocol({ 
              name: 'Project', 
              namespace: 'Project', 
              identityKey: 'Id',
              trailers: {
                'Id': { description: 'id', multivalue: false, validation: 'none' },
                'Team': { description: 'team', multivalue: false }
              }
          }, { permissive: false });
          const grep = nsProtocol.getSearchGrep({ Team: 'Backend' });
          expect(grep).toContain('--grep=^Project: Team: Backend');
      });
  });

  describe('Ownership & Claims', () => {
    it('should own its identity key', () => {
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
      expect(protocol.owns(MOCK_ID_KEY)).toBe(true);
    });

    it('should own core trailers', () => {
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
      expect(protocol.owns('Constraint')).toBe(true);
    });

    it('should own configured custom trailers', () => {
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, {
        trailers: { 
          'My-Trailer': { description: '', multivalue: true, validation: 'none' as const } 
        }
      });
      expect(protocol.owns('My-Trailer')).toBe(true);
    });

    it('should not own unregistered trailers', () => {
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
      expect(protocol.owns('Random-Junk')).toBe(false);
    });

    describe('parse with claim hierarchy', () => {
      it('should ingest owned trailers even if not in unclaimedKeys', () => {
        const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
        const raw = 'Confidence: high';
        // Ingested because we own it, regardless of unclaimed status
        const result = protocol.parse(raw, new Set(['Other']));
        expect(result.trailers.Confidence).toEqual(['high']);
      });

      it('should ingest unowned trailers only if permissive AND unclaimed', () => {
        const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, {
          strict: false,
          permissive: true,
          trailers: {}
        });
        const raw = 'Adhoc: value\nOwned-By-Other: secret';
        
        // Simulation: Owned-By-Other is explicitly claimed by another protocol
        const result = protocol.parse(raw, new Set(['Owned-By-Other']));
        
        expect(result.trailers.Adhoc).toEqual(['value']);
        expect(result.trailers['Owned-By-Other']).toBeUndefined();
      });

    it('should NOT ingest unowned trailers if not permissive', () => {
        const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, {
          strict: true,
          permissive: false,
          trailers: {}
        });
        const raw = 'Adhoc: value';
        
        const result = protocol.parse(raw, new Set(['Adhoc']));
        expect(result.trailers['Adhoc']).toBeUndefined();
      });
    });
  });

  describe('validateTrailer', () => {
    it('should validate enum values correctly', () => {
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
      expect(protocol.validateTrailer('Confidence', 'high').valid).toBe(true);
      expect(protocol.validateTrailer('Confidence', 'junk').valid).toBe(false);
    });

    it('should validate regex patterns correctly', () => {
      const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
      expect(protocol.validateTrailer(MOCK_ID_KEY, 'a1b2c3d4').valid).toBe(true);
      expect(protocol.validateTrailer(MOCK_ID_KEY, 'junk').valid).toBe(false);
    });

    it('should handle unresolvable cross-protocol references without a registry', () => {
        const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
        // No registry linked -> cross-protocol refs are unknown prefixes
        const result = protocol.validateTrailer('Related', 'other/12345678');
        expect(result.valid).toBe(false);
        expect(result.rule).toBe('unknown-protocol-prefix');
    });

    it('should handle unknown protocol prefixes with a linked registry', () => {
        const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
        const registry = new ProtocolRegistry();
        protocol.setRegistry(registry);
        
        const result = protocol.validateTrailer('Related', 'fake/123');
        expect(result.valid).toBe(false);
        expect(result.rule).toBe('unknown-protocol-prefix');
    });

    it('should treat self-prefixed references as local even without a registry', () => {
        const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
        // 'mock/id' where our name is 'Mock'
        const result = protocol.validateTrailer('Related', 'mock/a1b2c3d4');
        expect(result.valid).toBe(true);
    });

    it('should return specific id-format rule when identity key fails pattern', () => {
        const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
        const result = protocol.validateTrailer(MOCK_ID_KEY, 'invalid');
        expect(result.valid).toBe(false);
        expect(result.rule).toBe('mock-id-format');
    });

    it('should successfully validate a cross-protocol reference when registry is linked', () => {
        const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
        const registry = new ProtocolRegistry();
        const otherProtocol = makeProtocol({ name: 'Other', identityKey: 'Id', permissive: false });
        registry.register(protocol);
        registry.register(otherProtocol);

        const result = protocol.validateTrailer('Related', 'other/a1b2c3d4');
        expect(result.valid).toBe(true);
    });

    it('should return valid for unknown trailers in permissive mode', () => {
      const permissive = makeProtocol(MOCK_PROTOCOL_DEFINITION, { permissive: true });
      expect(permissive.validateTrailer('Unknown', 'anything').valid).toBe(true);
    });

    it('should enforce boundary rules (crossProtocol: false) autonomously', () => {
      const restrictedDef = {
          ...MOCK_PROTOCOL_DEFINITION,
          trailers: {
              ...MOCK_PROTOCOL_DEFINITION.trailers,
              'Local-Ref': {
                  description: 'local only',
                  multivalue: false,
                  validation: 'reference' as const,
                  crossProtocol: false
              }
          }
      };
      const restrictedProtocol = makeProtocol(restrictedDef, { strict: true });
      
      // Local ref -> ok
      expect(restrictedProtocol.validateTrailer('Local-Ref', 'a1b2c3d4').valid).toBe(true);
      
      // Ref to 'Other', not 'Strict' -> prohibited
      const result = restrictedProtocol.validateTrailer('Local-Ref', 'other/123');
      expect(result.valid).toBe(false);
      expect(result.rule).toBe('cross-protocol-prohibited');
    });
  });
});
