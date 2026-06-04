import { type ProtocolDefinition } from '../../../src/engine/core/types/protocol-definition.js';
import { JsonFormatter } from '../../../src/engine/formatters/json-formatter.js';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { Validator } from '../../../src/engine/services/validator.js';
import { NullQueryCache } from '../../../src/engine/shell/fs/query-cache.js';
import { TEST_ENGINE_CONFIG, TEST_PROTOCOL_DEFINITION, makeProtocol, makeQueryTarget } from '../../../src/engine/testing.js';
import { makeMockGitClient } from '../engine-test-utils.js';

import { describe, it, expect, vi } from 'vitest';


/**
 * ARCHITECTURAL TEST: Protocol Agnosticism
 * 
 * Verifies that the engine can host a completely custom protocol ("Fred")
 * and correctly isolate its data without any knowledge of "Lore".
 */
describe('Engine Protocol Rebranding Flow', () => {
  it('should flow a custom protocol from raw trailers to namespaced JSON output', async () => {
    // 1. Define a custom protocol "Fred"
    const fredDef: ProtocolDefinition = {
      name: 'Fred',
      version: '2.5',
      namespace: 'fred', 
      identityKey: 'Fred-id',
      trailers: {
        'Fred-id': {
          description: 'Fred identity',
          multivalue: false,
          validation: 'pattern',
          pattern: '^[0-9a-f]{8}$',
        },
        'Status': {
          description: 'Fred status',
          multivalue: false,
          validation: 'none',
        }
      }
    };

    const fredProtocol = makeProtocol(fredDef, {
        identityKey: 'Fred-id',
        name: 'Fred',
        namespace: 'fred',
        trailers: { ...fredDef.trailers, strict: false, permissive: true }
    });
    const registry = new ProtocolRegistry();
    registry.register(fredProtocol);
    
    // 2. Mock Storage to return a Fred commit
    const mockGit = makeMockGitClient();
    const rawFredCommit = {
      hash: 'abc12345',
      date: new Date().toISOString(),
      author: 'fred@example.com',
      subject: 'feat: fredly change',
      body: '',
      trailers: 'fred: Fred-id: aabbccdd\nfred: Status: active',
      filesChanged: ['src/fred.ts']
    };
    vi.mocked(mockGit.query).mockResolvedValue([rawFredCommit]);
    vi.mocked(mockGit.getFilesChanged).mockResolvedValue(new Map([['abc12345', ['src/fred.ts']]]));

    // 3. Setup Repository
    const repo = new AtomRepository(
      mockGit as any,
      registry,
      new NullQueryCache(),
      makeQueryTarget()
    );

    const atoms = await repo.find(makeQueryTarget());
    expect(atoms).toHaveLength(1);
    const atom = atoms[0];

    // 4. Verify interpretation (Protocol data must be namespaced by name)
    expect(atom.protocols.has('fred')).toBe(true);
    const fredState = atom.protocols.get('fred')!;
    expect(fredState.trailers['Fred-id']).toEqual(['aabbccdd']);

    // 5. Format to JSON using the Engine's generic formatter
    const formatter = new JsonFormatter(registry);
    const json = JSON.parse(formatter.formatQueryResult({
      result: {
        atoms,
        meta: { totalAtoms: 1, filteredAtoms: 1, oldest: null, newest: null },
        command: 'search',
        target: 'all',
        targetType: 'global'
      },
      supersessionMap: new Map(),
      visibleTrailers: 'all',
    }));

    // 6. Verify Agnostic Structure (Data is in .protocols.fred)
    expect(json.results[0].commit).toBe('abc12345');
    expect(json.results[0].protocols.fred.id).toBe('aabbccdd');
    expect(json.results[0].protocols.fred.trailers.Status).toBe('active');

    // 7. Validation Integration (Ensures Validator respects custom definition)
    const validator = new Validator(repo, TEST_ENGINE_CONFIG, registry);
    const results = await validator.validate([rawFredCommit]);
    expect(results[0].issues).toHaveLength(0);

    // Negative case: invalid ID based on Fred's custom pattern
    // 5. Verify validation of bad commit
    const badRawCommit = { ...rawFredCommit, trailers: 'fred: Fred-id: not-hex' };
    const results2 = await validator.validate([badRawCommit]);
    const formatIssue = results2[0].issues.find(i => i.rule === 'fred-id-format');
    expect(formatIssue).toBeDefined();
  });
});