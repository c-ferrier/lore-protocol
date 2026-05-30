import { describe, it, expect, beforeEach } from 'vitest';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { TEST_PROTOCOL_CONFIG } from '../engine/test-utils.js';

const LORE_ID_KEY = 'Lore-id';

describe('LoreProtocolDefinition', () => {
  let protocol: Protocol;

  beforeEach(() => {
    protocol = new Protocol(LoreProtocolDefinition, TEST_PROTOCOL_CONFIG);
  });

  it(`should have CLI metadata for all standard trailers except ${LORE_ID_KEY}`, () => {
    const definitions = protocol.getFormattableDefinitions();
    for (const [key, def] of Object.entries(definitions)) {
      if (key === LORE_ID_KEY) continue;
      
      // Verification via Protocol engine rather than raw object
      const fullDef = protocol.getDefinition(key);
      expect(fullDef?.cli, `Trailer "${key}" is missing CLI flag metadata`).toBeDefined();
      expect(fullDef?.cli?.flag, `Trailer "${key}" is missing a flag name`).toBeDefined();
    }
  });

  it(`should have prompt metadata for all standard trailers except ${LORE_ID_KEY}`, () => {
    const definitions = protocol.getFormattableDefinitions();
    for (const [key, def] of Object.entries(definitions)) {
      if (key === LORE_ID_KEY) continue;
      
      expect(def.directives, `Trailer "${key}" is missing directives`).toBeDefined();
      
      const fullDef = protocol.getDefinition(key);
      expect(fullDef?.prompt, `Trailer "${key}" is missing prompt metadata`).toBeDefined();
      expect(fullDef?.prompt?.confirm, `Trailer "${key}" is missing a confirm message`).toBeDefined();
      
      if (def.validation === 'values') {
        expect(fullDef?.prompt?.choice, `Enum trailer "${key}" is missing a choice message`).toBeDefined();
      } else {
        expect(fullDef?.prompt?.input, `Input trailer "${key}" is missing an input message`).toBeDefined();
      }
    }
  });

  it('should have UI kinds and colors for all standard trailers', () => {
    const definitions = protocol.getFormattableDefinitions();
    for (const [key, def] of Object.entries(definitions)) {
      expect(def.ui, `Trailer "${key}" is missing UI metadata`).toBeDefined();
      expect(def.ui?.color, `Trailer "${key}" is missing a UI color`).toBeDefined();
      expect(def.ui?.kind, `Trailer "${key}" is missing a UI kind`).toBeDefined();
    }
  });

  describe('derivation logic', () => {
    it('should correctly identify ARRAY_TRAILER_KEYS', () => {
      const listKeys = protocol.getListKeys();
      expect(listKeys).toContain('Constraint');
      expect(listKeys).toContain('Rejected');
      expect(listKeys).not.toContain('Confidence');
    });

    it('should correctly identify scalar keys', () => {
      const scalarKeys = protocol.getScalarKeys();
      expect(scalarKeys).toContain('Confidence');
      expect(scalarKeys).toContain('Scope-risk');
      expect(scalarKeys).not.toContain('Constraint');
    });

    it('should derive enum values from metadata options', () => {
      const def = protocol.getDefinition('Confidence');
      expect(Object.keys(def?.values || {})).toEqual(['low', 'medium', 'high']);
    });
  });
});
