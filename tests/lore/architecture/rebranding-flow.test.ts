import { describe, expect, it, vi } from 'vitest';

import { ProtocolMap } from '../../../src/engine/core/models/protocol-map.js';
import { type ProtocolDefinition } from '../../../src/engine/core/types/protocol-definition.js';
import { NullQueryCache } from '../../../src/engine/shell/fs/query-cache.js';
import { findAtoms } from '../../../src/engine/shell/orchestrators/discovery.js';
import { makeQueryTarget,makeStubProtocolContext, type ProtocolContext } from '../../../src/engine/testing.js';
import { LoreJsonFormatter } from '../../../src/lore/formatters/lore-json-formatter.js';
import { makeMockGitClient, makeMockInfra } from '../../engine/engine-test-utils.js';

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
      strict: true,
      permissive: false,
      trailers: {
        'Lore-id': { description: 'ID', multivalue: false, validation: 'none' },
        'Status': { description: 'S', multivalue: false, validation: 'none' }
      }
    };

    const loreProtocol = makeStubProtocolContext(loreDef);
    const protocols = new ProtocolMap<ProtocolContext>();
    protocols.set(loreProtocol.name, loreProtocol);

    // 2. Mock Storage to return a Lore commit
    const git = makeMockGitClient();
    const rawCommit = {
      hash: 'abc12345',
      date: new Date().toISOString(),
      author: 'dev@example.com',
      subject: 'feat: change',
      body: '',
      trailers: 'Lore-id: aabbccdd\nStatus: active',
      filesChanged: ['src/main.ts']
    };
    vi.mocked(git.queryStream).mockImplementation(async function* () { yield* [rawCommit]; });

    // 3. Setup Infra
    const infra = makeMockInfra({
      git,
      protocols,
      cache: new NullQueryCache(),
    });

    const atoms = await findAtoms(infra, makeQueryTarget());
    const atom = atoms[0];

    // 4. Format using the Lore-specific formatter
    const formatter = new LoreJsonFormatter(protocols);
    const json = JSON.parse(formatter.formatQueryResult({
      result: {
        atoms: [atom],
        meta: { totalAtoms: 1, filteredAtoms: 1, oldest: null, newest: null },
        command: 'search',
        target: 'all',
        targetType: 'global'
      },
      visibleTrailers: 'all',
    }));

    // 5. Verify Lore Branding (Flat keys, no .protocols nesting)
    expect(json.lore_version).toBe('0.6.0');
    expect(json.results[0].commit).toBe('abc12345');
    expect(json.results[0].lore_id).toBe('aabbccdd');
    expect(json.results[0].trailers.status).toBe('active');
  });
});