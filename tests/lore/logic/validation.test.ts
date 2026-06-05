import type { ProtocolContext } from '../../../src/engine/core/types/protocol-definition.js';
import { type RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { Validator } from '../../../src/engine/services/validator.js';
import { TEST_ENGINE_CONFIG, TEST_PROTOCOL_CONFIG, makeProtocol, makeRawCommit } from '../../../src/engine/testing.js';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';
import { makeMockAtomRepository } from '../../engine/engine-test-utils.js';

import { describe, it, expect, vi, beforeEach } from 'vitest';
;
;
;

describe('Lore Protocol Validation Contract', () => {
  let validator: Validator;
  let registry: ProtocolRegistry;
  let protocol: ProtocolContext;
  let mockAtomRepo: any;

  beforeEach(() => {
    protocol = makeProtocol(LoreProtocolDefinition, TEST_PROTOCOL_CONFIG);
    registry = new ProtocolRegistry();
    registry.register(protocol);
    mockAtomRepo = makeMockAtomRepository();

    validator = new Validator(
      mockAtomRepo,
      TEST_ENGINE_CONFIG,
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
    const invalid = makeRawCommit({ trailers: `Lore-id: a1b2c3d4\nSupersedes: toolong12` });
    const results = await validator.validate([invalid]);

    expect(results[0].issues.some(i => i.rule === 'reference-format' && i.field === 'Supersedes')).toBe(true);
  });
});