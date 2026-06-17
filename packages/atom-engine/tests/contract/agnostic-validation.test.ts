import { describe, expect, it } from 'vitest';

import { ProtocolMap } from '../../src/core/models/protocol-map.js';
import { validateCommits } from '../../src/shell/orchestrators/validation.js';
import { makeAtom, makeStubIdentityIndex, type ProtocolContext,TEST_ENGINE_CONFIG } from '../../src/testing.js';
import { makeMockGitClient, makeMockQueryCache } from '../engine-test-utils.js';

describe('Agnostic Validation (Zero Protocols)', () => {
  const infra = {
    git: makeMockGitClient(),
    cache: makeMockQueryCache(),
    identityIndex: makeStubIdentityIndex(),
    protocols: new ProtocolMap<ProtocolContext>(), // Empty
    config: TEST_ENGINE_CONFIG,
  };

  it('should still perform structural hygiene checks without protocols', async () => {
    const atom = makeAtom({
        subject: 'a'.repeat(100), // Exceeds default limit (50 in TEST_ENGINE_CONFIG)
        protocols: new Map() // No protocols
    });
    const results = await validateCommits([atom], infra);

    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true); // Warnings don't invalidate
    expect(results[0].issues.some(i => i.rule === 'subject-length')).toBe(true);
  });

  it('should return valid for a perfect standard git commit', async () => {
    const perfectAtom = makeAtom({ 
        subject: 'feat: valid subject',
        protocols: new Map()
    });
    const results = await validateCommits([perfectAtom], infra);

    expect(results[0].valid).toBe(true);
    expect(results[0].issues).toHaveLength(0);
  });
});