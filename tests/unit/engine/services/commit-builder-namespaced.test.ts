import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { describe, it, expect } from 'vitest';
import { CommitBuilder } from '../../../../src/engine/services/commit-builder.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import { IdGenerator } from '../../../../src/engine/services/id-generator.js';
import { LORE_DEFAULT_CONFIG } from '../../../../src/lore/defaults.js';

describe('CommitBuilder Namespacing', () => {
  const protocol = new Protocol({
    name: 'Lore',
    version: '1.0',
    identityKey: 'Lore-id',
    namespace: '',
    trailers: {
      'Lore-id': { description: 'ID', validation: 'none' as const }
    }
  }, LORE_DEFAULT_CONFIG);

  const registry = new ProtocolRegistry();
  registry.register(protocol);

  const idGenerator = new IdGenerator(protocol);
  const trailerParser = new TrailerParser();
  const builder = new CommitBuilder(trailerParser, idGenerator, LORE_DEFAULT_CONFIG, registry);

  it('should include namespaced trailers in the built message', () => {
    const input = {
      subject: 'feat: add feature',
      trailers: {
        'Lore-id': ['ignore-me'], // Should be replaced by generated ID
        'fred/Impact': ['high'],
        'jira/Issue': ['PROJ-123']
      }
    };

    const { message } = builder.build(input, { lore: 'lore123' });

    expect(message).toContain('Lore-id: lore123');
    expect(message).toContain('fred/Impact: high');
    expect(message).toContain('jira/Issue: PROJ-123');
  });

  it('should validate namespaced trailers if permissive is true', () => {
    // Lore is permissive by default in LORE_DEFAULT_CONFIG
    const input = {
      subject: 'feat: test',
      trailers: {
        'any/Trailer': ['val']
      }
    };

    const issues = builder.validate(input);
    expect(issues).toHaveLength(0);
  });
});
