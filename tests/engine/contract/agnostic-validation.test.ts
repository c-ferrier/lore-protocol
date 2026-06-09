import { describe, expect, it } from 'vitest';

import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { validateCommits } from '../../../src/engine/shell/orchestrators/validation.js';
import { makeAtom, TEST_ENGINE_CONFIG } from '../../../src/engine/testing.js';
import { makeMockAtomRepository } from '../engine-test-utils.js';

describe('Agnostic Validation (Zero Protocols)', () => {
  const deps = {
    atomRepository: makeMockAtomRepository(),
    config: TEST_ENGINE_CONFIG,
    protocolRegistry: new ProtocolRegistry() // Empty
  };

  it('should still perform structural hygiene checks without protocols', async () => {
    const atom = makeAtom({
        subject: 'a'.repeat(100), // Exceeds 72
        protocols: new Map() // No protocols
    });
    const results = await validateCommits([atom], deps);

    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true); // Warnings don't invalidate
    expect(results[0].issues.some(i => i.rule === 'subject-length')).toBe(true);
  });

  it('should return valid for a perfect standard git commit', async () => {
    const perfectAtom = makeAtom({ 
        subject: 'feat: valid subject',
        protocols: new Map()
    });
    const results = await validateCommits([perfectAtom], deps);

    expect(results[0].valid).toBe(true);
    expect(results[0].issues).toHaveLength(0);
  });
});