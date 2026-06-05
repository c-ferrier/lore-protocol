import { beforeEach,describe, expect, it } from 'vitest';

import { 
    getFormattableDefinitions,
    getListKeys,
    getScalarKeys} from '../../../src/engine/core/logic/protocols.js';
import type { ProtocolContext } from '../../../src/engine/core/types/protocol-definition.js';
import { makeProtocol,TEST_PROTOCOL_CONFIG } from '../../../src/engine/testing.js';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';

const LORE_ID_KEY = 'Lore-id';

describe('LoreProtocolDefinition', () => {
  let protocol: ProtocolContext;

  beforeEach(() => {
    protocol = makeProtocol(LoreProtocolDefinition, TEST_PROTOCOL_CONFIG);
  });

  it(`should have CLI metadata for all standard trailers except ${LORE_ID_KEY}`, () => {
    const definitions = getFormattableDefinitions(protocol);
    for (const key of Object.keys(definitions)) {
      if (key === LORE_ID_KEY) continue;
      
      // Verification via Protocol context trailers map
      const fullDef = protocol.trailers.get(key);
      expect(fullDef?.cli, `Trailer "${key}" is missing CLI flag metadata`).toBeDefined();
      expect(fullDef?.cli?.flag, `Trailer "${key}" is missing a flag name`).toBeDefined();
    }
  });

  it(`should have prompt metadata for all standard trailers except ${LORE_ID_KEY}`, () => {
    const definitions = getFormattableDefinitions(protocol);
    for (const [key, def] of Object.entries(definitions)) {
      if (key === LORE_ID_KEY) continue;
      
      const fullDef = protocol.trailers.get(key);
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
    const definitions = getFormattableDefinitions(protocol);
    for (const [key, def] of Object.entries(definitions)) {
      expect(def.ui, `Trailer "${key}" is missing UI metadata`).toBeDefined();
      expect(def.ui?.color, `Trailer "${key}" is missing a UI color`).toBeDefined();
      expect(def.ui?.kind, `Trailer "${key}" is missing a UI kind`).toBeDefined();
    }
  });

  describe('derivation logic', () => {
    it('should correctly identify ARRAY_TRAILER_KEYS', () => {
      const listKeys = getListKeys(protocol);
      expect(listKeys).toContain('Constraint');
      expect(listKeys).toContain('Rejected');
      expect(listKeys).not.toContain('Confidence');
    });

    it('should correctly identify scalar keys', () => {
      const scalarKeys = getScalarKeys(protocol);
      expect(scalarKeys).toContain('Confidence');
      expect(scalarKeys).toContain('Scope-risk');
      expect(scalarKeys).not.toContain('Constraint');
    });

    it('should derive enum values from metadata options', () => {
      const def = protocol.trailers.get('Confidence');
      expect(Object.keys(def?.values || {})).toEqual(['low', 'medium', 'high']);
    });
  });
});