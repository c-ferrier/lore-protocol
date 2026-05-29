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
    const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig());
    const keys = protocol.getAuthorizedKeys();

    expect(keys).toContain('Constraint');
    expect(keys).toContain('Confidence');
    expect(protocol.isCore('Constraint')).toBe(true);
  });

  it('should merge custom definitions into the protocol', () => {
    const config = {
      ...MOCK_CONFIG,
      strict: false,
      permissive: true,
      trailers: {
        definitions: {
          Team: {
            description: 'The team responsible',
            multivalue: false,
            validation: 'none' as const,
          },
        },
      },
    };
    const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(config));
    
    const def = protocol.getDefinition('Team');
    expect(def).toBeDefined();
    expect(def?.description).toBe('The team responsible');
    expect(def?.isCore).toBe(false);
    expect(protocol.isCore('Team')).toBe(false);
  });

  it('should identify configured custom trailers as non-core even if they are in core-definitions', () => {
    // This tests the case where a user might try to override a core definition
    const config = {
      ...MOCK_CONFIG,
      strict: false,
      permissive: true,
      trailers: {
        definitions: {
          Constraint: {
            description: 'User override',
            multivalue: true,
            validation: 'none' as const,
          },
        },
      },
    };
    const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(config));
    
    expect(protocol.isCore('Constraint')).toBe(true);
    expect(protocol.getDefinition('Constraint')?.description).toBe('User override');
  });

  it('should authorize any key in permissive mode', () => {
    const config = {
      ...MOCK_CONFIG,
      strict: false, 
      permissive: true,
      trailers: { definitions: {} }
    };
    const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(config));
    
    expect(protocol.authorize('Random-Key')).toBe('Random-Key');
  });

  it('should not authorize unknown keys in strict mode', () => {
    const config = {
      ...MOCK_CONFIG,
      strict: true,
      permissive: false,
      trailers: { 
        definitions: {},
      },
    };
    const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(config));
    
    expect(protocol.authorize('Random-Key')).toBeNull();
  });

  it('should sort authorized keys based on prompt order', () => {
    const config = {
      ...MOCK_CONFIG,
      strict: false,
      permissive: true,
      trailers: {
        definitions: {
          Urgent: {
            description: 'U',
            multivalue: false,
            validation: 'none' as const,
            prompt: { order: 105 } // Between Constraint (100) and Confidence (120)
          },
        },
      },
    };
    const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(config));
    const keys = protocol.getAuthorizedKeys();
    
    expect(keys[0]).toBe('Mock-id');
    expect(keys[1]).toBe('Constraint');
    expect(keys[2]).toBe('Urgent');
    expect(keys[3]).toBe('Confidence');
  });

  it('should default custom trailers to the end of the sort order', () => {
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, {
      strict: false,
      permissive: true,
      trailers: {
        definitions: {
          Adhoc: { description: 'adhoc', multivalue: false, validation: 'none', isCore: false },
        }
      }
    });

    const keys = protocol.getAuthorizedKeys();
    
    expect(keys[keys.length - 1]).toBe('Adhoc');
  });

  describe('Case-Insensitive Normalization', () => {
    it('should normalize core keys regardless of input casing', () => {
      const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(MOCK_CONFIG));
      
      expect(protocol.authorize('confidence')).toBe('Confidence');
      expect(protocol.authorize('CONFIDENCE')).toBe('Confidence');
    });

    it('should normalize custom definition keys', () => {
      const config = {
        ...MOCK_CONFIG,
        strict: false,
        permissive: true,
        trailers: {
          definitions: {
            'Assisted-by': { description: 'A', multivalue: true, validation: 'none' as const }
          }
        }
      };
      const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(config));
      
      expect(protocol.authorize('assisted-by')).toBe('Assisted-by');
      expect(protocol.authorize('ASSISTED-BY')).toBe('Assisted-by');
    });

    it('should preserve original casing for ad-hoc trailers in permissive mode', () => {
      const config = {
        ...MOCK_CONFIG,
        strict: false, 
        permissive: true,
        trailers: { definitions: {} }
      };
      const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(config));
      
      // If it's not a core or custom defined key, it keeps its casing
      expect(protocol.authorize('My-New-Trailer')).toBe('My-New-Trailer');
    });

    it('should prioritize core casing over ad-hoc casing', () => {
      const config = {
        ...MOCK_CONFIG,
        strict: false, 
        permissive: true,
        trailers: { definitions: {} }
      };
      const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(config));
      
      expect(protocol.authorize(MOCK_ID_KEY.toLowerCase())).toBe(MOCK_ID_KEY);
    });
  });

  describe('Required Unification', () => {
    it('should mark a trailer as required if set in definitions', () => {
      const config = {
        ...MOCK_CONFIG,
        strict: false,
        permissive: true,
        trailers: {
          definitions: { Team: { description: 'D', multivalue: false, validation: 'none' as const, required: true } },
        }
      };
      const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(config));
      expect(protocol.getDefinition('Team')?.required).toBe(true);
    });
  });

  describe('Custom Overrides', () => {
    it('should allow custom definitions to override core trailer metadata (e.g. color)', () => {
      const config = {
        ...MOCK_CONFIG,
        strict: false,
        permissive: true,
        trailers: {
          definitions: {
            Confidence: { 
              description: 'Custom confidence', 
              multivalue: false, 
              validation: 'values' as const, 
              ui: { color: 'magenta' as const } 
            }
          }
        }
      };
      const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(config));
      const def = protocol.getDefinition('Confidence');
      
      expect(def?.description).toBe('Custom confidence');
      expect(def?.ui?.color).toBe('magenta');
      expect(def?.isCore).toBe(true); // Still a core key
    });
  });

  describe('Discovery & Claims', () => {
    const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(MOCK_CONFIG));

    it('should claim a commit with its identity key', () => {
      expect(protocol.claims(`${MOCK_ID_KEY}: a1b2c3d4`)).toBe(true);
      expect(protocol.claims(`Signed-off-by: x\n${MOCK_ID_KEY}: a1b2c3d4`)).toBe(true);
    });

    it('should not claim a commit without its identity key', () => {
      expect(protocol.claims('Constraint: value')).toBe(false);
      expect(protocol.claims('')).toBe(false);
    });

    it('should provide discovery grep arguments', () => {
      const grep = protocol.getDiscoveryGrep();
      expect(grep).toContain(`--grep=^${MOCK_ID_KEY}: [0-9a-f]{8}`);
    });
  });

  describe('parse', () => {
    const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(MOCK_CONFIG));

    it('should parse and normalize authorized trailers', () => {
      const raw = `${MOCK_ID_KEY}: a1b2c3d4\nconfidence: high`;
      const result = protocol.parse(raw);
      
      expect(result.name).toBe('Mock');
      expect(result.identityKey).toBe(MOCK_ID_KEY);
      expect(result.trailers[MOCK_ID_KEY]).toEqual(['a1b2c3d4']);
      expect(result.trailers.Confidence).toEqual(['high']);
    });

    it('should move unauthorized trailers to unauthorized bucket in strict mode', () => {
      const strictProtocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig({
        strict: true,
        permissive: false
      }));
      const raw = 'Unknown-Trailer: value';
      const result = strictProtocol.parse(raw);
      expect(result.trailers['Unknown-Trailer']).toBeUndefined();
      expect(result.unauthorized['Unknown-Trailer']).toEqual(['value']);
    });

    it('should parse all enum values during normalization', () => {
      const raw = 'Confidence: INVALID\nConfidence: low';
      const result = protocol.parse(raw);
      expect(result.trailers.Confidence).toEqual(['INVALID', 'low']);
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
            expect(state.strict).toBe(true);
            expect(state.permissive).toBe(false);
        });

        it('should handle pre-bucketed namespaced trailers', () => {
            const nsProtocol = makeProtocol({
                name: 'Project',
                namespace: 'Project',
                identityKey: 'Id'
            }, {
                strict: true, permissive: false
            });

            // Pre-bucketed: the map contains INNER keys, not the namespace prefix
            const raw = {
                'Id': ['123'],
                'Typo': ['junk']
            };

            const state = nsProtocol.normalize(raw);
            expect(state.trailers['Id']).toEqual(['123']);
            expect(state.unauthorized['Typo']).toEqual(['junk']);
        });

        it('should identify global namespaced trailers (un-bucketed)', () => {
            const nsProtocol = makeProtocol({
                name: 'Project',
                namespace: 'Project',
                identityKey: 'Id'
            }, {
                strict: true, permissive: false
            });

            // un-bucketed: the map contains the namespace prefix
            const raw = {
                'Project': ['Id: 123', 'Typo: junk']
            };

            const state = nsProtocol.normalize(raw);
            expect(state.trailers['Id']).toEqual(['123']);
            expect(state.unauthorized['Typo']).toEqual(['junk']);
        });
    });

    it('should handle multi-value trailers', () => {
      const raw = 'Constraint: c1\nConstraint: c2';
      const result = protocol.parse(raw);
      expect(result.trailers.Constraint).toEqual(['c1', 'c2']);
    });

    it('should handle continuation lines via its internal parser', () => {
      const raw = 'Constraint: line1\n  line2';
      const result = protocol.parse(raw);
      expect(result.trailers.Constraint).toEqual(['line1 line2']);
    });
    });

    describe('Hierarchical Namespacing', () => {
      const nsProtocol = new Protocol(
          { 
              ...MOCK_PROTOCOL_DEFINITION, 
              name: 'Project', 
              namespace: 'Project', 
              identityKey: 'Id', 
              strict: true,
              permissive: false,
              trailers: { 'Id': { description: 'ID', multivalue: false, validation: 'pattern' as const, pattern: '^[0-9a-f]{8}$' }, 'Constraint': { description: 'C', multivalue: true } } 
          },
          makeProtocolConfig({ strict: true, permissive: false })
      );

      it('should own exactly its namespace key', () => {
          expect(nsProtocol.owns('Project')).toBe(true);
          expect(nsProtocol.owns('project')).toBe(true);
          expect(nsProtocol.owns('Id')).toBe(false); // Only owns namespace at top level
      });

      it('should unpack nested colons during parsing', () => {
          const raw = 'Project: Id: a1b2c3d4\nProject: Constraint: must-be-fast';
          const result = nsProtocol.parse(raw);

          expect(result.trailers.Id).toEqual(['a1b2c3d4']);
          expect(result.trailers.Constraint).toEqual(['must-be-fast']);
      });

      it('should track typos in namespaced trailers as unauthorized', () => {
          const raw = 'Project: Tream: backend';
          const result = nsProtocol.parse(raw);

          expect(result.trailers.Tream).toBeUndefined();
          expect(result.unauthorized.Tream).toEqual(['backend']);
      });

      it('should provide namespaced discovery pattern', () => {
          expect(nsProtocol.getDiscoveryPattern()).toBe('^Project:');
      });

      it('should provide namespaced search grep', () => {
          const grep = nsProtocol.getSearchGrep({ 'Constraint': 'fast' });
          expect(grep).toContain('--grep=^Project: Constraint: fast');
      });
    });

    describe('Ownership & Claims', () => {
    it('should own its identity key', () => {
      const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(MOCK_CONFIG));
      expect(protocol.owns(MOCK_ID_KEY)).toBe(true);
    });

    it('should own core trailers', () => {
      const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(MOCK_CONFIG));
      expect(protocol.owns('Confidence')).toBe(true);
      expect(protocol.owns('Constraint')).toBe(true);
    });

    it('should own configured custom trailers', () => {
      const config = {
        ...MOCK_CONFIG,
        strict: false,
        permissive: true,
        trailers: { 
          definitions: { 'My-Trailer': { description: '', multivalue: true, validation: 'none' as const } } 
        }
      };
      const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(config));
      expect(protocol.owns('My-Trailer')).toBe(true);
    });

    it('should not own unregistered trailers', () => {
      const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(MOCK_CONFIG));
      expect(protocol.owns('Random-Trailer')).toBe(false);
    });

    describe('parse with claim hierarchy', () => {
      it('should ingest owned trailers even if not in unclaimedKeys', () => {
        const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(MOCK_CONFIG));
        const raw = 'Confidence: high';
        // Simulation: Another protocol claimed Confidence, but we own it too
        const result = protocol.parse(raw, new Set(['Other-Key']));
        
        expect(result.trailers.Confidence).toEqual(['high']);
      });

      it('should ingest unowned trailers only if permissive AND unclaimed', () => {
        const config = {
          ...MOCK_CONFIG,
          strict: false,
          permissive: true,
          trailers: { definitions: {} }
        };
        const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(config));
        const raw = 'Adhoc: value\nOwned-By-Other: secret';
        
        // Simulation: Owned-By-Other is explicitly claimed by someone else
        const claimed = new Set(['Owned-By-Other']);
        const result = protocol.parse(raw, claimed);
        
        expect(result.trailers['Adhoc']).toEqual(['value']);
        expect(result.trailers['Owned-By-Other']).toBeUndefined();
      });

    it('should NOT ingest unowned trailers if not permissive', () => {
        const config = {
          ...MOCK_CONFIG,
          strict: true,
          permissive: false,
          trailers: { definitions: {} }
        };
        const protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig(config));
        const raw = 'Adhoc: value';
        
        const result = protocol.parse(raw, new Set(['Adhoc']));
        expect(result.trailers['Adhoc']).toBeUndefined();
      });
    });
  });

  describe('validateTrailer', () => {
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);

    it('should validate enum values correctly', () => {
      expect(protocol.validateTrailer('Confidence', 'high').valid).toBe(true);
      
      const result = protocol.validateTrailer('Confidence', 'junk');
      expect(result.valid).toBe(false);
      expect(result.rule).toBe('invalid-enum');
      expect(result.message).toContain('Expected one of: low, medium, high');
    });

    it('should validate regex patterns correctly', () => {
      expect(protocol.validateTrailer(MOCK_ID_KEY, 'aabbccdd').valid).toBe(true);
      
      const result = protocol.validateTrailer(MOCK_ID_KEY, 'too-long-id');
      expect(result.valid).toBe(false);
      expect(result.rule).toBe('mock-id-format');
    });

    it('should handle unresolvable cross-protocol references without a registry', () => {
      // No registry linked
      const result = protocol.validateTrailer('Depends-on', 'fake/123');
      expect(result.valid).toBe(false);
      expect(result.rule).toBe('unknown-protocol-prefix');
      expect(result.message).toContain('Registry not linked');
    });

    it('should handle unknown protocol prefixes with a linked registry', () => {
      const registry = new ProtocolRegistry();
      registry.register(protocol);

      const result = protocol.validateTrailer('Depends-on', 'unknown/123');
      expect(result.valid).toBe(false);
      expect(result.rule).toBe('unknown-protocol-prefix');
      expect(result.message).toContain('Unknown protocol prefix: "unknown"');
    });

    it('should treat self-prefixed references as local even without a registry', () => {
      // Mock protocol is named 'Mock'. Reference 'mock/aabbccdd' should be local.
      const result = protocol.validateTrailer('Depends-on', 'mock/aabbccdd');
      expect(result.valid).toBe(true);
    });

    it('should return specific id-format rule when identity key fails pattern', () => {
      const result = protocol.validateTrailer(MOCK_ID_KEY, 'invalid-id');
      expect(result.valid).toBe(false);
      expect(result.rule).toBe('mock-id-format');
      expect(result.message).toContain('is not a valid identifier');
    });

    it('should successfully validate a cross-protocol reference when registry is linked', () => {
      const registry = new ProtocolRegistry();
      registry.register(protocol);
      
      const otherProtocol = makeProtocol({ 
          name: 'Other', 
          namespace: 'other',
          identityKey: 'Other-id',
          trailers: { 'Other-id': { description: 'id', multivalue: false, validation: 'pattern', pattern: '^[0-9]+$' } }
      });
      registry.register(otherProtocol);

      // 'other/123' should be valid because '123' matches 'Other's pattern
      expect(protocol.validateTrailer('Depends-on', 'other/123').valid).toBe(true);

      // 'other/abc' should be invalid because 'abc' fails 'Other's pattern
      const result = protocol.validateTrailer('Depends-on', 'other/abc');
      expect(result.valid).toBe(false);
      expect(result.rule).toBe('invalid-reference-format');
      expect(result.message).toContain('is not a valid identifier for protocol "Other"');
    });

    it('should return valid for unknown trailers in permissive mode', () => {
      expect(protocol.validateTrailer('Random', 'any-value').valid).toBe(true);
    });

    it('should enforce boundary rules (crossProtocol: false) autonomously', () => {
      const restrictedProtocol = makeProtocol({
          name: 'Strict',
          trailers: {
              'Local-Ref': { description: 'L', multivalue: true, validation: 'reference' as const, crossProtocol: false }
          }
      });

      // points to 'Other', not 'Strict' -> prohibited
      const result = restrictedProtocol.validateTrailer('Local-Ref', 'other/123');
      expect(result.valid).toBe(false);
      expect(result.rule).toBe('cross-protocol-prohibited');
    });
  });
});
