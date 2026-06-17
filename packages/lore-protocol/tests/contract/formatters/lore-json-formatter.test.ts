import { ProtocolMap } from '@c-ferrier/atom-engine/testing';
import { type Atom,makeAtom, makeStubProtocolContext, makeStubProtocolMap, makeStubProtocolState, type ProtocolContext } from '@c-ferrier/atom-engine/testing';
import { beforeEach,describe, expect, it } from 'vitest';

import { TestLogger } from '../../../../atom-engine/tests/engine-test-utils.js';
import { LoreJsonFormatter } from '../../../src/formatters/lore-json-formatter.js';

describe('LoreJsonFormatter', () => {
  let protocols: ProtocolMap<ProtocolContext>;
  let formatter: LoreJsonFormatter;
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
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
    const header = formatter.formatQueryHeader({ target: 'all', type: 'global', visibleTrailers: 'all' });
    if (header) logger.result(header);
    
    const body = formatter.formatQueryAtom({ atom, visibleTrailers: 'all' });
    if (body) logger.result(body);
    
    const footer = formatter.formatQueryFooter({ total: 1, filtered: 1, oldest: null, newest: null });
    if (footer) logger.result(footer);
    
    return JSON.parse(logger.results.join(''));
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

    // 1. Header should log the opening of the document
    const header = formatter.formatQueryHeader({ target: 'all', type: 'global', visibleTrailers: 'all' });
    if (header) logger.result(header);
    expect(logger.results[0]).toContain('"results": [');
    
    // 2. Atoms should log stringified objects
    const atom1 = formatter.formatQueryAtom({ atom: a1, visibleTrailers: 'all' });
    if (atom1) logger.result(atom1);
    const atom2 = formatter.formatQueryAtom({ atom: a2, visibleTrailers: 'all' });
    if (atom2) logger.result(atom2);
    
    expect(logger.results[1]).toContain('"h1"');
    expect(logger.results[2]).toContain('"h2"');
    
    // 3. Footer should log the closing and metadata
    const footer = formatter.formatQueryFooter({ total: 2, filtered: 2, oldest: null, newest: null });
    if (footer) logger.result(footer);
    expect(logger.results[3]).toContain('"total_atoms": 2');

    const output = JSON.parse(logger.results.join(''));
    expect(output.results).toHaveLength(2);
    expect(output.results[0].commit).toBe('h1');
    expect(output.results[1].commit).toBe('h2');
  });
});