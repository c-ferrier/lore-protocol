import { describe, it, expect, vi } from 'vitest';
import { Protocol, ProtocolRegistry, type ProtocolDefinition } from '../../../src/engine/index.js';
import { 
  AtomRepository, 
  SearchFilter, 
  NullQueryCache,
  TEST_ENGINE_CONFIG, 
  TEST_PROTOCOL_CONFIG, 
  makeMockGitClient,
  makeQueryTarget,
  makeMockTargetFactory
} from '../../engine/engine-test-utils.js';
import { LoreJsonFormatter } from '../../../src/lore/formatters/lore-json-formatter.js';

/**
 * ARCHITECTURAL TEST: Wrapper Rebranding
 * 
 * Verifies that the Lore wrapper can successfully rebrand the generic engine
 * output into the opinionated "Lore" 0.5.0 format.
 */
describe('Lore Wrapper Rebranding Flow', () => {
  it('should rebrand the generic engine output into Lore flat JSON', async () => {
    // 1. Define a protocol named 'Lore'
    const loreDef: ProtocolDefinition = {
      name: 'Lore',
      version: '0.6.0',
      namespace: '', 
      identityKey: 'Lore-id',
      trailers: {
        'Lore-id': { description: 'ID' },
        'Status': { description: 'S' }
      }
    };

    const loreProtocol = new Protocol(loreDef, TEST_PROTOCOL_CONFIG);
    const registry = new ProtocolRegistry();
    registry.register(loreProtocol);

    // 2. Mock Storage to return a Lore commit
    const mockGit = makeMockGitClient();
    const rawCommit = {
      hash: 'abc12345',
      date: new Date().toISOString(),
      author: 'dev@example.com',
      subject: 'feat: change',
      body: '',
      trailers: 'Lore-id: aabbccdd\nStatus: active',
      filesChanged: ['src/main.ts']
    };
    vi.mocked(mockGit.query).mockResolvedValue([rawCommit]);

    // 3. Setup Repository
    const targetFactory = makeMockTargetFactory();
    const repo = new AtomRepository(
      mockGit as any,
      registry,
      new SearchFilter(registry),
      new NullQueryCache(),
      makeQueryTarget(),
      targetFactory
    );

    const atoms = await repo.find(makeQueryTarget());
    const atom = atoms[0];

    // 4. Format using the Lore-specific formatter
    const formatter = new LoreJsonFormatter(registry);
    const json = JSON.parse(formatter.formatQueryResult({
      result: {
        atoms: [atom],
        meta: { totalAtoms: 1, filteredAtoms: 1, oldest: null, newest: null },
        command: 'search',
        target: 'all',
        targetType: 'global'
      },
      supersessionMap: new Map(),
      visibleTrailers: 'all',
    }));

    // 5. Verify Lore Branding (Flat keys, no .protocols nesting)
    expect(json.lore_version).toBe('0.6.0');
    expect(json.results[0].commit).toBe('abc12345');
    expect(json.results[0].lore_id).toBe('aabbccdd');
    expect(json.results[0].trailers.status).toBe('active');
  });
});
