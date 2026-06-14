import { beforeEach,describe, expect, it } from 'vitest';

import { ProtocolMap } from '../../../../src/engine/core/models/protocol-map.js';
import { makeAtom, makeStubProtocolContext, makeStubProtocolMap, makeStubProtocolState, type ProtocolContext } from '../../../../src/engine/testing.js';
import { LoreTextFormatter } from '../../../../src/lore/formatters/lore-text-formatter.js';

describe('LoreTextFormatter', () => {
  let protocols: ProtocolMap<ProtocolContext>;
  let formatter: LoreTextFormatter;

  beforeEach(() => {
    const lore = makeStubProtocolContext({ 
        name: 'lore', 
        identityKey: 'Lore-id',
        trailers: {
            'Confidence': { description: 'C', multivalue: false, validation: 'none' as const }
        }
    });
    protocols = makeStubProtocolMap([lore]);
    formatter = new LoreTextFormatter(protocols, { color: false });
  });

  it('should suppress [lore] prefix in the output (Lore 0.5.0 Parity)', () => {
    const atom = makeAtom({
      protocols: makeStubProtocolMap([['lore', makeStubProtocolState({ trailers: { 'Confidence': ['high'] } })]])
    });

    const output = formatter.formatQueryResult({
      result: {
        command: 'log',
        target: 'all',
        targetType: 'global',
        atoms: [atom],
        meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
      },
      visibleTrailers: 'all',
    });

    expect(output).toContain('Confidence: high');
    expect(output).not.toContain('[lore]');
  });

  it('should only indent the first line of the body (Lore 0.5.0 Parity)', () => {
    const atom = makeAtom({
      body: 'Line 1\nLine 2',
      protocols: makeStubProtocolMap([['lore', makeStubProtocolState({ trailers: { 'Lore-id': ['aaaa1111'] } })]])
    });

    const output = formatter.formatQueryResult({
      result: {
        command: 'log',
        target: 'all',
        targetType: 'global',
        atoms: [atom],
        meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
      },
      visibleTrailers: 'all',
    });

    expect(output).toContain('  Line 1');
    expect(output).toContain('\nLine 2');
  });

  it('should show success message as "Commit created: <hash>" (Lore 0.5.0 Parity)', () => {
    const output = formatter.formatSuccess('Done', { hash: 'abc12345' });
    expect(output).toBe('Commit created: abc12345');
  });

  it('should fallback to generic message if no hash is provided', () => {
    const output = formatter.formatSuccess('Done');
    expect(output).toContain('Done');
  });

  it('should show subject only if no trailers are present', () => {
    const atom = makeAtom({
      subject: 'feat: minimal',
      protocols: makeStubProtocolMap([['lore', makeStubProtocolState({ trailers: { 'Lore-id': ['aaaa1111'] } })]])
    });

    const output = formatter.formatQueryResult({
      result: {
        command: 'log',
        target: 'all',
        targetType: 'global',
        atoms: [atom],
        meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
      },
      visibleTrailers: 'all',
    });

    expect(output).toContain('feat: minimal');
    expect(output).not.toContain('Confidence:');
  });

  it('should match the footer format exactly (Lore 0.5.0 Parity)', () => {
    const atom = makeAtom();
    const output = formatter.formatQueryResult({
      result: {
        command: 'log',
        target: 'all',
        targetType: 'global',
        atoms: [atom],
        meta: { totalAtoms: 5, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
      },
      visibleTrailers: 'all',
    });

    expect(output).toContain('1 of 5 atoms shown');
  });
});