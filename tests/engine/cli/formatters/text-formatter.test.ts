import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { makeMockContext, TEST_ID_KEY, makeAtom } from '../../../../src/engine/testing.js';
import { TextFormatter } from '../../../../src/engine/cli/formatters/text-formatter.js';
import { describe, it, expect, beforeEach } from 'vitest';

describe('TextFormatter', () => {
  let registry: ProtocolRegistry;
  let formatter: TextFormatter;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    const protocol = makeMockContext({ name: 'mock' });
    registry.register(protocol);
    formatter = new TextFormatter(registry, { color: false });
  });

  it('should format a query result as human-readable text', () => {
    const atom = makeAtom({ trailers: { [TEST_ID_KEY]: ['a1b2c3d4'] } });
    const data = {
      result: {
        atoms: [atom],
        meta: { totalAtoms: 1, filteredAtoms: 1, oldest: null, newest: null },
        command: 'search' as const,
        target: 'all',
        targetType: 'global' as const
      },
      visibleTrailers: 'all' as const,
    };

    const output = formatter.formatQueryResult(data);
    expect(output).toContain('a1b2c3d4');
    expect(output).toContain(atom.subject);
  });
});
