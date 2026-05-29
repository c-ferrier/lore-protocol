import { describe, it, expect, beforeEach } from 'vitest';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';
import { TrailerParser } from '../../../src/engine/services/trailer-parser.js';
import { JsonFormatter } from '../../../src/engine/formatters/json-formatter.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { MOCK_PROTOCOL_CONFIG, makeProtocol } from '../engine/test-utils.js';

import type { FormattableQueryResult } from '../../../src/engine/types/output.js';
import type { Atom, Trailers } from '../../../src/engine/types/domain.js';

const LORE_ID_KEY = "Lore-id";

/**
 * Targeted tests for the boundaries and edge cases of the Flat & Uniform Protocol.
 */
describe('Flat Protocol Boundaries', () => {
  describe('Canonical Ordering', () => {
    it('should always serialize in protocol-defined order regardless of insertion order', () => {
      const protocol = new Protocol(LoreProtocolDefinition, MOCK_PROTOCOL_CONFIG);
      const parser = new TrailerParser();

      // Input in "wrong" order
      const trailers = {
        'Tested': ['T1'],
        'Confidence': ['high'],
        [LORE_ID_KEY]: ['id123'],
        'Constraint': ['C1'],
        'My-Custom': ['Val']
      } as any;

      const output = parser.serialize(trailers, protocol.getAuthorizedKeys());
      const lines = output.split('\n');

      // Canonical order from core-definitions.ts: 
      // Lore-id (always first) -> Constraint -> Confidence -> Tested -> Custom
      expect(lines[0]).toBe(`${LORE_ID_KEY}: id123`);
      expect(lines[1]).toBe('Constraint: C1');
      expect(lines[2]).toBe('Confidence: high');
      expect(lines[3]).toBe('Tested: T1');
      expect(lines[4]).toBe('My-Custom: Val');
    });
  });

  describe('JSON Normalization Matrix', () => {
    it('should correctly coerce core scalars and preserve all other arrays', () => {
      const protocol = new Protocol(LoreProtocolDefinition, MOCK_PROTOCOL_CONFIG);
      const registry = new ProtocolRegistry();
      registry.register(protocol);
      const formatter = new JsonFormatter(registry);
      
      const trailers: Trailers = {
        [LORE_ID_KEY]: ['id'],
        'Confidence': ['high'],      // Scalar core
        'Constraint': ['C1', 'C2'],  // Array core
        'Tested': ['T1'],            // Array core (single value)
        'Custom': ['V1'],            // Custom (defaults to array)
      };

      const atom: Atom = {
        id: 'id',
        commitHash: 'h',
        date: new Date(),
        author: 'a',
        subject: 'i',
        body: '',
        protocols: new Map([
          ['lore', { name: 'Lore', version: '1.0', identityKey: LORE_ID_KEY, trailers }]
        ]),
        filesChanged: []
      };


      const data: FormattableQueryResult = {
        result: { atoms: [atom], meta: { totalAtoms: 1, filteredAtoms: 1, oldest: null, newest: null }, command: 'c', target: 't', targetType: 'file' },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = JSON.parse(formatter.formatQueryResult(data));
      const lore = output.results[0].protocols.lore;

      expect(lore.trailers.Confidence).toBe('high');        // Canonical Key + Coerced to scalar
      expect(lore.trailers.Constraint).toEqual(['C1', 'C2']); // Canonical Key + Remained array
      expect(lore.trailers.Tested).toEqual(['T1']);           // Canonical Key + Remained array
      expect(lore.trailers.Custom).toEqual(['V1']);           // Remained array
    });
  });

  describe('Strict Mode Boundaries', () => {
    it('should strictly prune unauthorized custom trailers in non-permissive mode', () => {
      const protocol = makeProtocol(LoreProtocolDefinition, {
        trailers: { 
          permissive: false, 
          definitions: { 'Authorized': { description: '', multivalue: true, validation: 'none' } } 
        }
      });
      const parser = new TrailerParser();

      const raw = `${LORE_ID_KEY}: abc\nAuthorized: yes\nUnauthorized: no`;
      const result = protocol.parse(raw);
      const parsed = result.trailers;

      expect(parsed['Authorized']).toEqual(['yes']);
      expect(parsed['Unauthorized']).toBeUndefined();
      
      const serialized = parser.serialize(parsed, protocol.getAuthorizedKeys());
      expect(serialized).not.toContain('Unauthorized');
    });
  });

  describe('Key Case Resilience', () => {
    it('should treat trailers as case-insensitive for core mapping', () => {
      const protocol = new Protocol(LoreProtocolDefinition, MOCK_PROTOCOL_CONFIG);
      const parser = new TrailerParser();

      // User provides lowercase 'confidence'
      const raw = `${LORE_ID_KEY}: abc\nconfidence: low`;
      const result = protocol.parse(raw);
      const parsed = result.trailers;

      // Should be mapped to the canonical PascalCase key
      expect(parsed['Confidence']).toEqual(['low']);
      
      const serialized = parser.serialize(parsed, protocol.getAuthorizedKeys());
      expect(serialized).toContain('Confidence: low');
      expect(serialized).not.toContain('confidence:');
    });
  });
});
