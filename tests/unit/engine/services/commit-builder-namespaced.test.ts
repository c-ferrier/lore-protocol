import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { describe, it, expect } from 'vitest';
import { CommitBuilder } from '../../../../src/engine/services/commit-builder.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import { IdGenerator } from '../../../../src/engine/services/id-generator.js';
import { MOCK_CONFIG } from '../test-utils.js';

describe('CommitBuilder Namespacing', () => {
  const protocol = new Protocol({
    name: 'Mock',
    version: '1.0',
    identityKey: 'Mock-id',
    namespace: '',
    trailers: {
      'Mock-id': { description: 'ID', multivalue: false, validation: 'none' as const }
    }
  }, MOCK_CONFIG);

  const registry = new ProtocolRegistry();
  registry.register(protocol);

  const idGenerator = new IdGenerator();
  const trailerParser = new TrailerParser();
  const builder = new CommitBuilder(trailerParser, idGenerator, MOCK_CONFIG, registry);

  it('should include namespaced trailers in the built message', () => {
    const input = {
      subject: 'feat: add feature',
      trailers: {
        'Mock-id': ['ignore-me'], // Should be replaced by generated ID
        'fred/Impact': ['high'],
        'jira/Issue': ['PROJ-123']
      }
    };

    const { message } = builder.build(input, { mock: 'mock123' });

    expect(message).toContain('Mock-id: mock123');
    expect(message).toContain('fred/Impact: high');
    expect(message).toContain('jira/Issue: PROJ-123');
  });

  it('should validate namespaced trailers if permissive is true', () => {
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
