import { describe, expect, it } from 'vitest';

import { LoreTextFormatter } from '../../../../src/lore/formatters/lore-text-formatter.js';
import { makeAtom, type ProtocolContext,ProtocolMap } from '../../../engine/engine-test-utils.js';

describe('LoreTextFormatter — Author Display Parity', () => {
  let formatter: LoreTextFormatter;

  it('should display only the email part of the author string', () => {
    const protocols = new ProtocolMap<ProtocolContext>();
    formatter = new LoreTextFormatter(protocols, { color: false });

    const atom = makeAtom({
      author: 'Cole Ferrier <cole.ferrier@gmail.com>',
      date: new Date('2026-05-25T12:00:00Z'),
    });

    const output = formatter.formatQueryAtom(atom);

    expect(output).toContain('cole.ferrier@gmail.com');
    expect(output).not.toContain('Cole Ferrier');
  });

  it('should handle author strings without brackets gracefully', () => {
    const protocols = new ProtocolMap<ProtocolContext>();
    formatter = new LoreTextFormatter(protocols, { color: false });

    const atom = makeAtom({
      author: 'cole.ferrier@gmail.com',
      date: new Date('2026-05-25T12:00:00Z'),
    });

    const output = formatter.formatQueryAtom(atom);

    expect(output).toContain('cole.ferrier@gmail.com');
  });

  it('should handle malformed author strings gracefully', () => {
    const protocols = new ProtocolMap<ProtocolContext>();
    formatter = new LoreTextFormatter(protocols, { color: false });

    const atom = makeAtom({
      author: 'Unknown Author', // No email
      date: new Date('2026-05-25T12:00:00Z'),
    });

    const output = formatter.formatQueryAtom(atom);

    expect(output).toContain('Unknown Author');
  });
});