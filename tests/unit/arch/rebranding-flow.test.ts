import { describe, it, expect, vi } from 'vitest';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { JsonFormatter } from '../../../src/engine/formatters/json-formatter.js';
import { TrailerParser } from '../../../src/engine/services/trailer-parser.js';
import { SearchFilter } from '../../../src/engine/services/search-filter.js';
import { NullAtomCache } from '../../../src/engine/services/atom-cache.js';
import { NullQueryCache } from '../../../src/engine/services/query-cache.js';
import { MOCK_CONFIG, MOCK_PROTOCOL_CONFIG } from '../engine/test-utils.js';
import { Validator } from '../../../src/engine/services/validator.js';
import type { ProtocolDefinition } from '../../../src/engine/interfaces/protocol-definition.js';
import type { IGitClient } from '../../../src/engine/interfaces/git-client.js';
import type { Atom } from '../../../src/engine/types/domain.js';

describe('Rebranding Flow Integration', () => {
  it('should flow a custom protocol from raw trailers to rebranded JSON output', async () => {
    // 1. Define a custom protocol "Fred" as the ROOT protocol
    const fredDef: ProtocolDefinition = {
      name: 'Fred',
      version: '2.5',
      namespace: '', // Root namespace
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

    const config = {
      ...MOCK_PROTOCOL_CONFIG,
      trailers: { ...MOCK_PROTOCOL_CONFIG.trailers, strict: false, permissive: true }
    };

    const fredProtocol = new Protocol(fredDef, config);
    const registry = new ProtocolRegistry();
    registry.register(fredProtocol);

    // 2. Mock Git Client to return a Fred commit
    const mockGit: Partial<IGitClient> = {
      log: vi.fn(async () => [
        {
          hash: 'abc12345',
          date: new Date().toISOString(),
          author: 'fred@example.com',
          subject: 'feat: fredly change',
          body: '',
          trailers: 'Fred-id: aabbccdd\nStatus: active',
        }
      ]),
      getFilesChanged: vi.fn(async () => new Map([['abc12345', ['src/fred.ts']]])),
    };

    // 3. Setup Repository
    const repo = new AtomRepository(
      mockGit as any,
      new TrailerParser(),
      registry,
      new SearchFilter(registry),
      new NullAtomCache(),
      new NullQueryCache()
    );

    const atoms = await repo.findAll();
    expect(atoms).toHaveLength(1);
    const atom = atoms[0];

    // 4. Verify interpretation
    expect(atom.protocols.has('fred')).toBe(true);
    const fredState = atom.protocols.get('fred')!;
    expect(fredState.trailers['Fred-id']).toEqual(['aabbccdd']);
    expect(fredState.trailers['Status']).toEqual(['active']);

    // 5. Format to JSON
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

    // 6. Verify Total Neutrality (Top level is generic, protocol data is namespaced)
    expect(json.version).toBe('1.0'); // Engine version
    
    // Identity must be found inside the protocols map
    expect(json.results[0].protocols.fred.id).toBe('aabbccdd');
    expect(json.results[0].protocols.fred.version).toBe('2.5');
    
    // Top-level trailers should NOT exist (per Total Neutrality rules)
    expect(json.results[0]).not.toHaveProperty('trailers');
    expect(json.results[0]).not.toHaveProperty('fred_id');
  });

  it('should rebrand validation rules based on protocol name', async () => {
    // 1. Setup Fred protocol
    const fredDef: ProtocolDefinition = {
      name: 'Fred',
      version: '1.0',
      namespace: '',
      identityKey: 'Fred-id',
      trailers: {
        'Fred-id': {
          description: 'ID',
          multivalue: false,
          validation: 'pattern',
          pattern: '^[0-9a-f]{8}$',
          required: true,
        },
      }
    };
    const protocol = new Protocol(fredDef, MOCK_PROTOCOL_CONFIG);
    const registry = new ProtocolRegistry();
    registry.register(protocol);
    const validator = new Validator(new TrailerParser(), {} as any, MOCK_CONFIG, registry);

    // 2. Validate a commit with missing Fred-id
    const commit = {
      hash: 'h1',
      date: new Date().toISOString(),
      author: 'a',
      subject: 's',
      body: '',
      trailers: '', // Missing Fred-id
    };

    const results = await validator.validate([commit]);
    const issues = results[0].issues;

    // 3. Verify rule name is rebranded
    const presenceIssue = issues.find(i => i.rule === 'fred-id-present');
    expect(presenceIssue).toBeDefined();
    expect(presenceIssue?.message).toContain('[Fred] Fred-id trailer is missing');

    // 4. Validate invalid format
    const invalidCommit = {
      ...commit,
      trailers: 'Fred-id: not-hex',
    };
    const results2 = await validator.validate([invalidCommit]);
    const formatIssue = results2[0].issues.find(i => i.rule === 'fred-id-format');
    expect(formatIssue).toBeDefined();
    expect(formatIssue?.message).toContain('[Fred] Fred-id "not-hex" is not a valid identifier');
  });
});
