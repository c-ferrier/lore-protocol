import { describe, expect,it } from 'vitest';

import { type RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { validateCommits } from '../../../src/engine/shell/orchestrators/validation.js';
import { TEST_ENGINE_CONFIG } from '../../../src/engine/testing.js';


describe('Agnostic Validation (Zero Protocols)', () => {
  const mockCommit: RawCommit = {
    hash: 'h1',
    date: new Date().toISOString(),
    author: 'cole@example.com',
    subject: 'a'.repeat(100), // Exceeds 72
    body: 'Some body text',
    trailers: '',
  };

  const deps = {
    atomRepository: {} as any,
    config: TEST_ENGINE_CONFIG,
    protocolRegistry: new ProtocolRegistry() // Empty
  };

  it('should still perform structural hygiene checks without protocols', async () => {
    const results = await validateCommits([mockCommit], deps);

    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true); // Warnings don't invalidate
    expect(results[0].issues.some(i => i.rule === 'subject-length')).toBe(true);
  });

  it('should return valid for a perfect standard git commit', async () => {
    const perfectCommit = { ...mockCommit, subject: 'feat: valid subject' };
    const results = await validateCommits([perfectCommit], deps);

    expect(results[0].valid).toBe(true);
    expect(results[0].issues).toHaveLength(0);
  });
});