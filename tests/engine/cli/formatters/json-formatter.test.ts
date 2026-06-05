import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { makeMockContext, TEST_ID_KEY, TEST_PROTOCOL_DEFINITION, makeAtom } from '../../../../src/engine/testing.js';
import { JsonFormatter } from '../../../../src/engine/cli/formatters/json-formatter.js';
import { describe, it, expect, beforeEach } from 'vitest';

describe('JsonFormatter', () => {
  let registry: ProtocolRegistry;
  let formatter: JsonFormatter;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    const protocol = makeMockContext({ name: 'mock' });
    registry.register(protocol);
    formatter = new JsonFormatter(registry);
  });

  it('should format a query result as JSON', () => {
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
    const parsed = JSON.parse(output);

    expect(parsed.version).toBe('1.0');
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].commit).toBe(atom.commitHash);
  });
});
