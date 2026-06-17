import { ProtocolMap, type RawCommit } from '@c-ferrier/atom-engine';
import type { ProtocolContext } from '@c-ferrier/atom-engine/testing';
import { hydrateAtoms, makeRawCommit,makeStubProtocolContext, TEST_ENGINE_CONFIG, validateCommits } from '@c-ferrier/atom-engine/testing';
import { beforeEach,describe, expect, it } from 'vitest';

import { makeMockInfra } from '../../../atom-engine/tests/engine-test-utils.js';
import { LoreProtocolDefinition } from '../../src/protocol-definition.js';


describe('Lore Protocol Validation Contract', () => {
  let protocols: ProtocolMap<ProtocolContext>;
  let protocol: ProtocolContext;

  beforeEach(() => {
    protocol = makeStubProtocolContext(LoreProtocolDefinition);
    protocols = new ProtocolMap();
    protocols.set(protocol.name, protocol);
  });

  const getInfra = () => makeMockInfra({
    protocols,
    config: TEST_ENGINE_CONFIG
  });

  const makeCommit = (trailers: string): RawCommit => ({
    hash: 'h1',
    date: new Date().toISOString(),
    author: 'a',
    subject: 's',
    body: '',
    trailers,
    filesChanged: [],
  });

  it('should enforce 8-character hex Lore-id', async () => {
    const valid = makeCommit('Lore-id: abc12345');
    const invalid = makeCommit('Lore-id: not-hex-!');
    const tooShort = makeCommit('Lore-id: abc123');

    const infra = getInfra();
    const results = await validateCommits(hydrateAtoms([valid, invalid, tooShort], protocols, { includeAllCommits: true }), infra);

    expect(results[0].valid).toBe(true);
    expect(results[1].issues.some(i => i.rule === 'lore-id-format')).toBe(true);
    expect(results[2].issues.some(i => i.rule === 'lore-id-format')).toBe(true);
  });

  it('should enforce Lore enum values for Confidence', async () => {
    const invalid = makeCommit('Lore-id: abc12345\nConfidence: extreme');
    const infra = getInfra();
    const results = await validateCommits(hydrateAtoms([invalid], protocols, { includeAllCommits: true }), infra);

    expect(results[0].issues.some(i => i.rule === 'invalid-enum' && i.field === 'Confidence')).toBe(true);
    expect(results[0].issues[0].message).toContain('low, medium, high');
  });

  it('should enforce Lore enum values for Scope-risk', async () => {
    const invalid = makeCommit('Lore-id: abc12345\nScope-risk: critical');
    const infra = getInfra();
    const results = await validateCommits(hydrateAtoms([invalid], protocols, { includeAllCommits: true }), infra);

    expect(results[0].issues.some(i => i.rule === 'invalid-enum' && i.field === 'Scope-risk')).toBe(true);
    expect(results[0].issues.find(i => i.field === 'Scope-risk')?.message).toContain('narrow, moderate, wide');
  });

  it('should enforce Lore enum values for Reversibility', async () => {
    const invalid = makeCommit('Lore-id: abc12345\nReversibility: partially');
    const infra = getInfra();
    const results = await validateCommits(hydrateAtoms([invalid], protocols, { includeAllCommits: true }), infra);

    expect(results[0].issues.some(i => i.rule === 'invalid-enum' && i.field === 'Reversibility')).toBe(true);
    expect(results[0].issues.find(i => i.field === 'Reversibility')?.message).toContain('clean, migration-needed, irreversible');
  });

  it('should enforce "alternative | reason" pattern for Rejected trailers', async () => {
    const valid = makeCommit('Lore-id: abc12345\nRejected: option A | too slow');
    const invalid = makeCommit('Lore-id: abc12345\nRejected: just an option');

    const infra = getInfra();
    const results = await validateCommits(hydrateAtoms([valid, invalid], protocols, { includeAllCommits: true }), infra);

    expect(results[0].valid).toBe(true);
    expect(results[1].issues.some(i => i.rule === 'invalid-format' && i.field === 'Rejected')).toBe(true);
  });

  it('should enforce 8-character hex format for references (Supersedes, Related)', async () => {
    const invalid = makeRawCommit({ trailers: `Lore-id: a1b2c3d4\nSupersedes: toolong12` });
    const infra = getInfra();
    const results = await validateCommits(hydrateAtoms([invalid], protocols, { includeAllCommits: true }), infra);

    expect(results[0].issues.some(i => i.rule === 'reference-format' && i.field === 'Supersedes')).toBe(true);
  });
});