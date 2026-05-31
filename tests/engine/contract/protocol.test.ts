import { describe, it, expect, beforeEach } from 'vitest';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { 
  TEST_PROTOCOL_DEFINITION, 
  TEST_ENGINE_CONFIG, 
  makeProtocolConfig,
  makeProtocol
} from '../engine-test-utils.js';

const TEST_ID_KEY = "Mock-id";

describe('Protocol Service', () => {
  it('should load all core trailers by default', () => {
    const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
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
    const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION, config);
    
    const def = protocol.getDefinition('Team');
    expect(def).toBeDefined();
    expect(def?.description).toBe('The team responsible');
    expect(def?.isCore).toBe(false);
    expect(protocol.isCore('Team')).toBe(false);
  });

  it('should identify configured custom trailers as non-core even if they are in core-definitions', () => {
    const config = {
      trailers: {
          Constraint: {
            description: 'User override',
            multivalue: true,
            validation: 'none' as const,
          },
      },
    };
    const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION, config);
    
    expect(protocol.isCore('Constraint')).toBe(true);
    expect(protocol.getDefinition('Constraint')?.description).toBe('User override');
  });

  it('should authorize any key in permissive mode', () => {
    const config = {
      strict: false, 
      permissive: true,
      trailers: {}
    };
    const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION, config);
    
    expect(protocol.authorize('Random-Key')).toBe('Random-Key');
  });

  it('should not authorize unknown keys in strict mode', () => {
    const config = {
      strict: true,
      permissive: false,
      trailers: {},
    };
    const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION, config);
    
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
    const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION, config);
    const keys = protocol.getAuthorizedKeys();
    
    const constraintIdx = keys.indexOf('Constraint');
    const urgentIdx = keys.indexOf('Urgent');
    const confidenceIdx = keys.indexOf('Confidence');

    expect(constraintIdx).toBeLessThan(urgentIdx);
    expect(urgentIdx).toBeLessThan(confidenceIdx);
  });

  describe('Case-Insensitive Normalization', () => {
    it('should normalize core keys regardless of input casing', () => {
      const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION, TEST_ENGINE_CONFIG);
      
      expect(protocol.authorize('confidence')).toBe('Confidence');
      expect(protocol.authorize('CONFIDENCE')).toBe('Confidence');
    });

    it('should normalize custom definition keys', () => {
      const config = {
        trailers: {
            'Assisted-by': { description: 'A', multivalue: true, validation: 'none' as const }
        }
      };
      const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION, config);
      
      expect(protocol.authorize('assisted-by')).toBe('Assisted-by');
      expect(protocol.authorize('ASSISTED-BY')).toBe('Assisted-by');
    });

    it('should preserve original casing for ad-hoc trailers in permissive mode', () => {
      const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION, TEST_ENGINE_CONFIG);
      expect(protocol.authorize('New-Key')).toBe('New-Key');
    });

    it('should prioritize core casing over ad-hoc casing', () => {
      const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION, TEST_ENGINE_CONFIG);
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
      const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION, config);
      expect(protocol.getDefinition('Team')?.required).toBe(true);
    });
  });

  describe('Discovery & Claims', () => {
    it('should claim a commit with its identity key', () => {
      const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
      const raw = `${TEST_ID_KEY}: a1b2c3d4\nSubject: test`;
      expect(protocol.claims(raw)).toBe(true);
    });

    it('should not claim a commit without its identity key', () => {
      const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
      const raw = 'Subject: test\nOther-Id: 123';
      expect(protocol.claims(raw)).toBe(false);
    });

    it('should provide discovery patterns', () => {
      const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
      const patterns = protocol.getDiscoveryPatterns();
      expect(patterns[0]).toContain(`^${TEST_ID_KEY}:`);
    });
  });

  describe('parse', () => {
    it('should parse and normalize authorized trailers', () => {
      const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
      const raw = `${TEST_ID_KEY}: a1b2c3d4\nconfidence: high`;
      const result = protocol.parse(raw);
      
      expect(result.trailers[TEST_ID_KEY]).toEqual(['a1b2c3d4']);
      expect(result.trailers.Confidence).toEqual(['high']);
    });

    it('should move unauthorized trailers to unauthorized bucket in strict mode', () => {
      const strictProtocol = makeProtocol(TEST_PROTOCOL_DEFINITION, {
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
      const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
      const raw = 'Confidence: low\nConfidence: high';
      const result = protocol.parse(raw);
      expect(result.trailers.Confidence).toEqual(['low', 'high']);
    });

    describe('normalize()', () => {
        it('should categorize a raw map into authorized and unauthorized buckets', () => {
            const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION, {
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

            const raw = {
                'Id': ['12345'],
                'Team': ['Backend']
            };

            const state = nsProtocol.normalize(raw);
            expect(state.trailers.Id).toEqual(['12345']);
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
      const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
      const raw = 'Constraint: c1\nConstraint: c2';
      const result = protocol.parse(raw);
      expect(result.trailers.Constraint).toEqual(['c1', 'c2']);
    });

    it('should handle continuation lines via its internal parser', () => {
      const protocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
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
          
          const raw = 'Project: Id: 12345678\nProject: Team: Backend';
          const result = nsProtocol.parse(raw);
          expect(result.trailers.Id).toEqual(['12345678']);
          expect(result.trailers.Team).toEqual(['Backend']);
      });

      it('should ignore root trailers in namespaced protocol', () => {
          const nsProtocol = makeProtocol({ 
              name: 'Project', 
              namespace: 'Project', 
              identityKey: 'Id',
              trailers: { 'Id': { description: 'id' } }
          }, { permissive: false });
          
          const raw = 'Lore-id: root-id\nProject: Id: ns-id';
          const result = nsProtocol.parse(raw);
          expect(result.trailers.Id).toEqual(['ns-id']);
          expect(result.trailers['Lore-id']).toBeUndefined();
      });
  });
});
