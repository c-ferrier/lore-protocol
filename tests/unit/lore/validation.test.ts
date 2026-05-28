import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Validator } from '../../../src/engine/services/validator.js';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';
import { LORE_DEFAULT_CONFIG } from '../../../src/lore/defaults.js';
import { TrailerParser } from '../../../src/engine/services/trailer-parser.js';
import type { RawCommit } from '../../../src/engine/interfaces/git-client.js';

describe('Lore Protocol Validation Contract', () => {
  let validator: Validator;
  let registry: ProtocolRegistry;
  let protocol: Protocol;
  let trailerParser: TrailerParser;

  beforeEach(() => {
    protocol = new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG);
    registry = new ProtocolRegistry();
    registry.register(protocol);
    trailerParser = new TrailerParser();

    validator = new Validator(
      trailerParser,
      { findById: vi.fn().mockResolvedValue(null) } as any,
      LORE_DEFAULT_CONFIG,
      registry
    );
  });

  const makeCommit = (trailers: string): RawCommit => ({
    hash: 'h1',
    date: new Date().toISOString(),
    author: 'a',
    subject: 's',
    body: '',
    trailers,
  });

  it('should enforce 8-character hex Lore-id', async () => {
    const valid = makeCommit('Lore-id: abc12345');
    const invalid = makeCommit('Lore-id: not-hex-!');
    const tooShort = makeCommit('Lore-id: abc123');

    const results = await validator.validate([valid, invalid, tooShort]);

    expect(results[0].valid).toBe(true);
    expect(results[1].issues.some(i => i.rule === 'lore-id-format')).toBe(true);
    expect(results[2].issues.some(i => i.rule === 'lore-id-format')).toBe(true);
  });

  it('should enforce Lore enum values for Confidence', async () => {
    const invalid = makeCommit('Lore-id: abc12345\nConfidence: extreme');
    const results = await validator.validate([invalid]);

    expect(results[0].issues.some(i => i.rule === 'invalid-enum' && i.field === 'Confidence')).toBe(true);
    expect(results[0].issues[0].message).toContain('low, medium, high');
  });

  it('should enforce Lore enum values for Scope-risk', async () => {
    const invalid = makeCommit('Lore-id: abc12345\nScope-risk: critical');
    const results = await validator.validate([invalid]);

    expect(results[0].issues.some(i => i.rule === 'invalid-enum' && i.field === 'Scope-risk')).toBe(true);
    expect(results[0].issues.find(i => i.field === 'Scope-risk')?.message).toContain('narrow, moderate, wide');
  });

  it('should enforce Lore enum values for Reversibility', async () => {
    const invalid = makeCommit('Lore-id: abc12345\nReversibility: partially');
    const results = await validator.validate([invalid]);

    expect(results[0].issues.some(i => i.rule === 'invalid-enum' && i.field === 'Reversibility')).toBe(true);
    expect(results[0].issues.find(i => i.field === 'Reversibility')?.message).toContain('clean, migration-needed, irreversible');
  });

  it('should enforce "alternative | reason" pattern for Rejected trailers', async () => {
    const valid = makeCommit('Lore-id: abc12345\nRejected: option A | too slow');
    const invalid = makeCommit('Lore-id: abc12345\nRejected: just an option');

    const results = await validator.validate([valid, invalid]);

    expect(results[0].valid).toBe(true);
    expect(results[1].issues.some(i => i.rule === 'invalid-format' && i.field === 'Rejected')).toBe(true);
  });

  it('should enforce 8-character hex format for references (Supersedes, Related)', async () => {
    const invalid = makeCommit('Lore-id: abc12345\nSupersedes: bad-id');
    const results = await validator.validate([invalid]);

    expect(results[0].issues.some(i => i.rule === 'invalid-reference-format' && i.field === 'Supersedes')).toBe(true);
  });
});
