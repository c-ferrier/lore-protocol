import { beforeEach,describe, expect, it } from 'vitest';

import { ProtocolMap } from '../../../../src/engine/core/models/protocol-map.js';
import { type Atom,makeAtom, makeStubProtocolContext, makeStubProtocolMap, makeStubProtocolState, type ProtocolContext } from '../../../../src/engine/testing.js';
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

  const formatQueryResult = (atom: Atom) => {
    formatter.formatQueryHeader('all', 'global');
    formatter.formatQueryAtom(atom);
    return JSON.parse(formatter.formatQueryFooter({ total: 1, filtered: 1, oldest: null, newest: null }));
  };

  it('should include intent key in the output (Lore 0.5.0 Parity)', () => {
    const atom = makeAtom({
      subject: 'feat: add login',
      date: new Date('2025-01-15T10:00:00Z'),
      protocols: makeStubProtocolMap([['lore', makeStubProtocolState({ trailers: { 'Lore-id': ['aaaa1111'] } })]])
    });

    const output = formatQueryResult(atom);
    expect(output.results[0].intent).toBe('feat: add login');
  });

  it('should include lore_id at the top level and inside trailers (Lore 0.5.0 Parity)', () => {
      const atom = makeAtom({
        protocols: makeStubProtocolMap([['lore', makeStubProtocolState({ trailers: { 'Lore-id': ['aaaa1111'] } })]])
      });

      const output = formatQueryResult(atom);
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

    const output = formatQueryResult(atom);
    expect(output.results[0].trailers.confidence).toBe('high');
    expect(output.results[0].trailers.scope_risk).toBe('moderate');
  });

  it('should correctly buffer and flush multiple atoms (State Management)', () => {
    const a1 = makeAtom({ commitHash: 'h1' });
    const a2 = makeAtom({ commitHash: 'h2' });

    // 1. Header should return nothing (reset/init phase)
    expect(formatter.formatQueryHeader('all', 'global')).toBe('');
    
    // 2. Atoms should return nothing (buffering phase)
    expect(formatter.formatQueryAtom(a1)).toBe('');
    expect(formatter.formatQueryAtom(a2)).toBe('');
    
    // 3. Footer should return the final monolithic document (flush phase)
    const output = JSON.parse(formatter.formatQueryFooter({ total: 2, filtered: 2, oldest: null, newest: null }));

    expect(output.results).toHaveLength(2);
    expect(output.results[0].commit).toBe('h1');
    expect(output.results[1].commit).toBe('h2');
  });
});