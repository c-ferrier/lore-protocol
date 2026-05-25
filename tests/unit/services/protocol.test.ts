import { describe, it, expect } from 'vitest';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';
import { LORE_DEFAULT_CONFIG } from '../../../src/lore/defaults.js';

const LORE_ID_KEY = "Lore-id";


describe('Protocol Service', () => {
  it('should load all core trailers by default', () => {
    const protocol = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);
    const keys = protocol.getAuthorizedKeys();

    expect(keys).toContain('Constraint');
    expect(keys).toContain('Confidence');
    expect(protocol.isCore('Constraint')).toBe(true);
  });

  it('should merge custom definitions into the protocol', () => {
    const config = {
      ...LORE_DEFAULT_CONFIG,
      trailers: {
        ...LORE_DEFAULT_CONFIG.trailers,
        definitions: {
          Team: {
            description: 'The team responsible',
            multivalue: false,
            validation: 'none' as const,
          },
        },
      },
    };
    const protocol = new Protocol(LoreProtocolDefinition, config);
    
    const def = protocol.getDefinition('Team');
    expect(def).toBeDefined();
    expect(def?.description).toBe('The team responsible');
    expect(def?.isCore).toBe(false);
    expect(protocol.isCore('Team')).toBe(false);
  });

  it('should identify configured custom trailers as non-core even if they are in core-definitions', () => {
    // This tests the case where a user might try to override a core definition
    const config = {
      ...LORE_DEFAULT_CONFIG,
      trailers: {
        ...LORE_DEFAULT_CONFIG.trailers,
        definitions: {
          Constraint: {
            description: 'User override',
            multivalue: true,
            validation: 'none' as const,
          },
        },
      },
    };
    const protocol = new Protocol(LoreProtocolDefinition, config);
    
    expect(protocol.isCore('Constraint')).toBe(true);
    expect(protocol.getDefinition('Constraint')?.description).toBe('User override');
  });

  it('should authorize any key in permissive mode', () => {
    const config = {
      ...LORE_DEFAULT_CONFIG,
      trailers: { ...LORE_DEFAULT_CONFIG.trailers, permissive: true },
    };
    const protocol = new Protocol(LoreProtocolDefinition, config);
    
    expect(protocol.authorize('Random-Key')).toBe('Random-Key');
  });

  it('should not authorize unknown keys in strict mode', () => {
    const config = {
      ...LORE_DEFAULT_CONFIG,
      trailers: { 
        ...LORE_DEFAULT_CONFIG.trailers, 
        permissive: false,
        definitions: {},
        custom: []
      },
    };
    const protocol = new Protocol(LoreProtocolDefinition, config);
    
    expect(protocol.authorize('Random-Key')).toBeNull();
  });

  it('should sort authorized keys based on prompt order', () => {
    const config = {
      ...LORE_DEFAULT_CONFIG,
      trailers: {
        ...LORE_DEFAULT_CONFIG.trailers,
        definitions: {
          Urgent: {
            description: 'U',
            multivalue: false,
            validation: 'none' as const,
            prompt: { order: 105 } // Between Constraint (100) and Rejected (110)
          },
        },
      },
    };
    const protocol = new Protocol(LoreProtocolDefinition, config);
    const keys = protocol.getAuthorizedKeys();
    
    expect(keys[0]).toBe('Lore-id');
    expect(keys[1]).toBe('Constraint');
    expect(keys[2]).toBe('Urgent');
    expect(keys[3]).toBe('Rejected');
  });

  it('should default custom trailers to the end of the sort order', () => {
    const config = {
      ...LORE_DEFAULT_CONFIG,
      trailers: {
        ...LORE_DEFAULT_CONFIG.trailers,
        custom: ['Adhoc'],
      },
    };
    const protocol = new Protocol(LoreProtocolDefinition, config);
    const keys = protocol.getAuthorizedKeys();
    
    expect(keys[keys.length - 1]).toBe('Adhoc');
  });

  describe('Case-Insensitive Normalization', () => {
    it('should normalize core keys regardless of input casing', () => {
      const protocol = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);
      
      expect(protocol.authorize('confidence')).toBe('Confidence');
      expect(protocol.authorize('CONFIDENCE')).toBe('Confidence');
      expect(protocol.authorize('Scope-Risk')).toBe('Scope-risk');
    });

    it('should normalize custom definition keys', () => {
      const config = {
        ...LORE_DEFAULT_CONFIG,
        trailers: {
          ...LORE_DEFAULT_CONFIG.trailers,
          definitions: {
            'Assisted-by': { description: 'A', multivalue: true, validation: 'none' as const }
          }
        }
      };
      const protocol = new Protocol(LoreProtocolDefinition, config);
      
      expect(protocol.authorize('assisted-by')).toBe('Assisted-by');
      expect(protocol.authorize('ASSISTED-BY')).toBe('Assisted-by');
    });

    it('should preserve original casing for ad-hoc trailers in permissive mode', () => {
      const config = {
        ...LORE_DEFAULT_CONFIG,
        trailers: { ...LORE_DEFAULT_CONFIG.trailers, permissive: true }
      };
      const protocol = new Protocol(LoreProtocolDefinition, config);
      
      // If it's not a core or custom defined key, it keeps its casing
      expect(protocol.authorize('My-New-Trailer')).toBe('My-New-Trailer');
    });

    it('should prioritize core casing over ad-hoc casing', () => {
      const config = {
        ...LORE_DEFAULT_CONFIG,
        trailers: { ...LORE_DEFAULT_CONFIG.trailers, permissive: true }
      };
      const protocol = new Protocol(LoreProtocolDefinition, config);
      
      expect(protocol.authorize(LORE_ID_KEY.toLowerCase())).toBe(LORE_ID_KEY);
    });
  });

  describe('Required Unification', () => {
    it('should mark a trailer as required if set in definitions', () => {
      const config = {
        ...LORE_DEFAULT_CONFIG,
        trailers: {
          ...LORE_DEFAULT_CONFIG.trailers,
          definitions: { Team: { description: 'D', multivalue: false, validation: 'none' as const, required: true } },
        }
      };
      const protocol = new Protocol(LoreProtocolDefinition, config);
      expect(protocol.getDefinition('Team')?.required).toBe(true);
    });

    it('should mark a trailer as required if set in trailers.required list', () => {
      const config = {
        ...LORE_DEFAULT_CONFIG,
        trailers: {
          ...LORE_DEFAULT_CONFIG.trailers,
          required: ['Team'],
          custom: ['Team'],
        }
      };
      const protocol = new Protocol(LoreProtocolDefinition, config);
      expect(protocol.getDefinition('Team')?.required).toBe(true);
    });

    it('should handle case-insensitive required list entries', () => {
      const config = {
        ...LORE_DEFAULT_CONFIG,
        trailers: {
          ...LORE_DEFAULT_CONFIG.trailers,
          required: ['team'], // Lowercase entry
          custom: ['Team'],
        }
      };
      const protocol = new Protocol(LoreProtocolDefinition, config);
      expect(protocol.getDefinition('Team')?.required).toBe(true);
    });
  });

  describe('Custom Overrides', () => {
    it('should allow custom definitions to override core trailer metadata (e.g. color)', () => {
      const config = {
        ...LORE_DEFAULT_CONFIG,
        trailers: {
          ...LORE_DEFAULT_CONFIG.trailers,
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
      const protocol = new Protocol(LoreProtocolDefinition, config);
      const def = protocol.getDefinition('Confidence');
      
      expect(def?.description).toBe('Custom confidence');
      expect(def?.ui?.color).toBe('magenta');
      expect(def?.isCore).toBe(true); // Still a core key
    });
  });

  describe('Discovery & Claims', () => {
    const protocol = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);

    it('should claim a commit with its identity key', () => {
      expect(protocol.claims(`${LORE_ID_KEY}: a1b2c3d4`)).toBe(true);
      expect(protocol.claims(`Signed-off-by: x\n${LORE_ID_KEY}: a1b2c3d4`)).toBe(true);
    });

    it('should not claim a commit without its identity key', () => {
      expect(protocol.claims('Constraint: value')).toBe(false);
      expect(protocol.claims('')).toBe(false);
    });

    it('should provide discovery grep arguments', () => {
      const grep = protocol.getDiscoveryGrep();
      expect(grep).toContain(`--grep=^${LORE_ID_KEY}: [0-9a-f]{8}`);
    });
  });

  describe('parse', () => {
    const protocol = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);

    it('should parse and normalize authorized trailers', () => {
      const raw = `${LORE_ID_KEY}: a1b2c3d4\nconfidence: high`;
      const result = protocol.parse(raw);
      
      expect(result.name).toBe('Lore');
      expect(result.identityKey).toBe(LORE_ID_KEY);
      expect(result.trailers[LORE_ID_KEY]).toEqual(['a1b2c3d4']);
      expect(result.trailers.Confidence).toEqual(['high']);
    });

    it('should ignore unauthorized trailers in strict mode', () => {
      const strictConfig = {
        ...LORE_DEFAULT_CONFIG,
        trailers: { ...LORE_DEFAULT_CONFIG.trailers, permissive: false }
      };
      const strictProtocol = new Protocol(LoreProtocolDefinition, strictConfig);
      const raw = 'Unknown-Trailer: value';
      const result = strictProtocol.parse(raw);
      expect(result.trailers['Unknown-Trailer']).toBeUndefined();
    });

    it('should validate and filter enum values during parsing', () => {
      const raw = 'Confidence: INVALID\nConfidence: low';
      const result = protocol.parse(raw);
      expect(result.trailers.Confidence).toEqual(['low']);
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
  describe('Ownership & Claims', () => {
    it('should own its identity key', () => {
      const protocol = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);
      expect(protocol.owns(LORE_ID_KEY)).toBe(true);
    });

    it('should own core trailers', () => {
      const protocol = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);
      expect(protocol.owns('Confidence')).toBe(true);
      expect(protocol.owns('Constraint')).toBe(true);
    });

    it('should own configured custom trailers', () => {
      const config = {
        ...LORE_DEFAULT_CONFIG,
        trailers: { ...LORE_DEFAULT_CONFIG.trailers, custom: ['My-Trailer'] }
      };
      const protocol = new Protocol(LoreProtocolDefinition, config);
      expect(protocol.owns('My-Trailer')).toBe(true);
    });

    it('should not own unregistered trailers', () => {
      const protocol = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);
      expect(protocol.owns('Random-Trailer')).toBe(false);
    });

    describe('parse with claim hierarchy', () => {
      it('should ingest owned trailers even if not in unclaimedKeys', () => {
        const protocol = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);
        const raw = 'Confidence: high';
        // Simulation: Another protocol claimed Confidence, but we own it too
        const result = protocol.parse(raw, new Set(['Other-Key']));
        
        expect(result.trailers.Confidence).toEqual(['high']);
      });

      it('should ingest unowned trailers only if permissive AND unclaimed', () => {
        const config = {
          ...LORE_DEFAULT_CONFIG,
          trailers: { ...LORE_DEFAULT_CONFIG.trailers, permissive: true }
        };
        const protocol = new Protocol(LoreProtocolDefinition, config);
        const raw = 'Adhoc: value\nOwned-By-Other: secret';
        
        // Simulation: Owned-By-Other is explicitly claimed by someone else
        const claimed = new Set(['Owned-By-Other']);
        const result = protocol.parse(raw, claimed);
        
        expect(result.trailers['Adhoc']).toEqual(['value']);
        expect(result.trailers['Owned-By-Other']).toBeUndefined();
      });

      it('should NOT ingest unowned trailers if not permissive', () => {
        const config = {
          ...LORE_DEFAULT_CONFIG,
          trailers: { ...LORE_DEFAULT_CONFIG.trailers, permissive: false }
        };
        const protocol = new Protocol(LoreProtocolDefinition, config);
        const raw = 'Adhoc: value';
        
        const result = protocol.parse(raw, new Set(['Adhoc']));
        expect(result.trailers['Adhoc']).toBeUndefined();
      });
    });
  });
});
});
