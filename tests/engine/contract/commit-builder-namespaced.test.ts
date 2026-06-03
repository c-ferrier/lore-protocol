import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { describe, it, expect, vi } from 'vitest';
import { CommitBuilder } from '../../../src/engine/services/commit-builder.js';
import { TEST_PROTOCOL_DEFINITION, TEST_ENGINE_CONFIG, makeProtocol, makeCommitInput } from '../engine-test-utils.js';
import type { CommitInput } from '../../../src/engine/types/commit.js';
import * as IdentityLogic from '../../../src/engine/logic/identity.js';

describe('CommitBuilder Namespacing', () => {

  it('should include namespaced trailers in the built message', () => {
    const registry = new ProtocolRegistry();
    const mockProtocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
    const fredProtocol = makeProtocol(
      { ...TEST_PROTOCOL_DEFINITION, name: 'Fred', namespace: 'fred', identityKey: 'Fred-id' },
      { trailers: { strict: false, permissive: true } }
    );
    const jiraProtocol = makeProtocol(
      { ...TEST_PROTOCOL_DEFINITION, name: 'Jira', namespace: 'jira', identityKey: 'Issue' },
      { permissive: false, trailers: { definitions: {} } }
    );

    registry.register(mockProtocol);
    registry.register(fredProtocol);
    registry.register(jiraProtocol);

    const builder = new CommitBuilder(TEST_ENGINE_CONFIG, registry);
    const spy = vi.spyOn(IdentityLogic, 'generateId');
    spy.mockReturnValueOnce('mock123').mockReturnValueOnce('fred456').mockReturnValueOnce('PROJ-123');

    const input = makeCommitInput({
      subject: 'feat: add feature',
      trailers: {
        'mock': {},
        'fred': { Impact: ['high'] },
        'jira': { Issue: ['PROJ-123'] }
      },
    });

    const { message } = builder.build(input);

    expect(message).toContain('Mock-id: mock123');
    expect(message).toContain('fred: Fred-id: fred456');
    expect(message).toContain('fred: Impact: high');
    expect(message).toContain('jira: Issue: PROJ-123');
    spy.mockRestore();
  });

  it('should validate namespaced trailers if permissive is true', () => {
    const registry = new ProtocolRegistry();
    const fredProtocol = makeProtocol(
      { name: 'Fred', namespace: 'fred', identityKey: 'Fred-id' },
      { strict: false, permissive: true }
    );
    registry.register(fredProtocol);

    const builder = new CommitBuilder(TEST_ENGINE_CONFIG, registry);

    const input = makeCommitInput({
      subject: 'feat: add feature',
      trailers: {
        'fred': { 'Adhoc': ['value'], 'Fred-id': ['a1b2c3d4'] }
      },
    });

    const issues = builder.validate(input);
    if (issues.length !== 0) console.log('ISSUES (Namespaced):', issues);
    expect(issues).toHaveLength(0);
  });
});
