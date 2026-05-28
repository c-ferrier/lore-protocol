import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { describe, it, expect, vi } from 'vitest';
import { CommitBuilder } from '../../../../src/engine/services/commit-builder.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG, makeProtocolConfig } from '../test-utils.js';
import type { CommitInput } from '../../../../src/engine/types/commit.js';

describe('CommitBuilder Namespacing', () => {
  const mockParser = new TrailerParser();
  const mockIdGen = { generate: vi.fn() };

  it('should include namespaced trailers in the built message', () => {
    const registry = new ProtocolRegistry();
    const mockProtocol = new Protocol(MOCK_PROTOCOL_DEFINITION, makeProtocolConfig());
    const fredProtocol = new Protocol(
      { ...MOCK_PROTOCOL_DEFINITION, name: 'Fred', namespace: 'fred', identityKey: 'Fred-id' },
      makeProtocolConfig({ ...MOCK_CONFIG, trailers: { ...MOCK_CONFIG.trailers, permissive: true } })
    );
    const jiraProtocol = new Protocol(
      { ...MOCK_PROTOCOL_DEFINITION, name: 'Jira', namespace: 'jira', identityKey: 'Issue' },
      makeProtocolConfig({ ...MOCK_CONFIG, trailers: { ...MOCK_CONFIG.trailers, permissive: false } })
    );

    registry.register(mockProtocol);
    registry.register(fredProtocol);
    registry.register(jiraProtocol);

    const builder = new CommitBuilder(mockParser, mockIdGen as any, MOCK_CONFIG, registry);
    mockIdGen.generate.mockReturnValueOnce('mock123').mockReturnValueOnce('fred456').mockReturnValueOnce('PROJ-123');

    const input: CommitInput = {
      subject: 'feat: add feature',
      trailers: {
        '': {},
        'fred': { Impact: ['high'] },
        'jira': { Issue: ['PROJ-123'] }
      },
    };

    const { message } = builder.build(input);

    expect(message).toContain('Mock-id: mock123');
    expect(message).toContain('fred: Fred-id: fred456');
    expect(message).toContain('fred: Impact: high');
    expect(message).toContain('jira: Issue: PROJ-123');
  });

  it('should validate namespaced trailers if permissive is true', () => {
    const registry = new ProtocolRegistry();
    const fredProtocol = new Protocol(
      { ...MOCK_PROTOCOL_DEFINITION, name: 'Fred', namespace: 'fred', identityKey: 'Fred-id' },
      makeProtocolConfig({ ...MOCK_CONFIG, trailers: { ...MOCK_CONFIG.trailers, permissive: true } })
    );
    registry.register(fredProtocol);

    const builder = new CommitBuilder(mockParser, mockIdGen as any, MOCK_CONFIG, registry);

    const input: CommitInput = {
      subject: 'feat: add feature',
      trailers: {
        'fred': { 'Adhoc': ['value'] }
      },
    };

    const issues = builder.validate(input);
    expect(issues).toHaveLength(0);
  });
});
