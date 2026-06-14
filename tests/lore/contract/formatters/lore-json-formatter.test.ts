import { beforeEach,describe, expect, it } from 'vitest';

import { ProtocolMap } from '../../../../src/engine/core/models/protocol-map.js';
import { makeAtom, makeStubProtocolContext, makeStubProtocolMap, makeStubProtocolState, type ProtocolContext } from '../../../../src/engine/testing.js';
import { LoreJsonFormatter } from '../../../../src/lore/formatters/lore-json-formatter.js';

describe('LoreJsonFormatter', () => {
  let protocols: ProtocolMap<ProtocolContext>;
  let formatter: LoreJsonFormatter;

  beforeEach(() => {
    const lore = makeStubProtocolContext({ 
        name: 'lore', 
        identityKey: 'Lore-id',
        trailers: {
            'Confidence': { description: 'C', multivalue: false, validation: 'none' as const },
            'Scope-risk': { description: 'S', multivalue: false, validation: 'none' as const }
        }
    });
    protocols = makeStubProtocolMap([lore]);
    formatter = new LoreJsonFormatter(protocols);
  });

  it('should include intent key in the output (Lore 0.5.0 Parity)', () => {
    const atom = makeAtom({
      subject: 'feat: add login',
      date: new Date('2025-01-15T10:00:00Z'),
      protocols: makeStubProtocolMap([['lore', makeStubProtocolState({ trailers: { 'Lore-id': ['aaaa1111'] } })]])
    });

    const output = JSON.parse(formatter.formatQueryResult({
      result: {
        command: 'log',
        target: 'all',
        targetType: 'global',
        atoms: [atom],
        meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
      },
      visibleTrailers: 'all',
    }));

    expect(output.results[0].intent).toBe('feat: add login');
  });

  it('should include lore_id at the top level and inside trailers (Lore 0.5.0 Parity)', () => {
      const atom = makeAtom({
        protocols: makeStubProtocolMap([['lore', makeStubProtocolState({ trailers: { 'Lore-id': ['aaaa1111'] } })]])
      });
  
      const output = JSON.parse(formatter.formatQueryResult({
        result: {
          command: 'log',
          target: 'all',
          targetType: 'global',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        visibleTrailers: 'all',
      }));
  
      expect(output.results[0].lore_id).toBe('aaaa1111');
      expect(output.results[0].trailers.lore_id).toBe('aaaa1111');
    });

  it('should snake_case trailer keys in output (Lore 0.5.0 Parity)', () => {
    const atom = makeAtom({
      protocols: makeStubProtocolMap([['lore', makeStubProtocolState({ 
          trailers: {
            'Confidence': ['high'],
            'Scope-risk': ['moderate'],
          }
      })]])
    });

    const output = JSON.parse(formatter.formatQueryResult({
      result: {
        command: 'log',
        target: 'all',
        targetType: 'global',
        atoms: [atom],
        meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
      },
      visibleTrailers: 'all',
    }));

    expect(output.results[0].trailers.confidence).toBe('high');
    expect(output.results[0].trailers.scope_risk).toBe('moderate');
  });
});