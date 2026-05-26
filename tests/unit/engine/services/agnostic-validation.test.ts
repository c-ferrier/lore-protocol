import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Validator } from '../../../../src/engine/services/validator.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { MOCK_CONFIG } from '../test-utils.js';
import type { RawCommit } from '../../../../src/engine/interfaces/git-client.js';

describe('Agnostic Validation (Zero Protocols)', () => {
  let validator: Validator;
  
  const mockCommit: RawCommit = {
    hash: 'h1',
    date: new Date().toISOString(),
    author: 'cole@example.com',
    subject: 'a'.repeat(100), // Exceeds 72
    body: 'Some body text',
    trailers: '',
  };

  beforeEach(() => {
    validator = new Validator(
      { parse: vi.fn().mockReturnValue({}) } as any,
      {} as any,
      MOCK_CONFIG,
      new ProtocolRegistry() // Empty
    );
  });

  it('should still perform structural hygiene checks without protocols', async () => {
    const results = await validator.validate([mockCommit]);

    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true); // Warnings don't invalidate
    expect(results[0].issues.some(i => i.rule === 'subject-length')).toBe(true);
  });

  it('should return valid for a perfect standard git commit', async () => {
    const perfectCommit = { ...mockCommit, subject: 'feat: valid subject' };
    const results = await validator.validate([perfectCommit]);

    expect(results[0].valid).toBe(true);
    expect(results[0].issues).toHaveLength(0);
  });
});
