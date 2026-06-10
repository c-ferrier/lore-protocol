import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hydrateAtoms } from '../../../../src/engine/core/logic/hydration.js';
import { ProtocolMap } from '../../../../src/engine/core/models/protocol-map.js';
import * as Discovery from '../../../../src/engine/shell/orchestrators/discovery.js';
import { validateCommits } from '../../../../src/engine/shell/orchestrators/validation.js';
import { 
    makeAtom,
    makeRawCommit, 
    makeStubProtocolContext, 
    type ProtocolContext
} from '../../../../src/engine/testing.js';
import { 
    makeMockInfra, 
    TEST_ENGINE_CONFIG} from '../../engine-test-utils.js';

vi.mock('../../../../src/engine/shell/orchestrators/discovery.js', () => ({
    findAtomsByIds: vi.fn(),
    getIdentityPattern: vi.fn()
}));

describe('Commit Validation (Shell Orchestrator)', () => {
  const protocol = makeStubProtocolContext({
    name: 'Test',
    version: '1.0',
    identityKey: 'Test-id',
    trailers: {
      'Test-id': { description: 'ID', multivalue: false, validation: 'pattern', pattern: '^T-\\d+$' },
      'Ref-id': { description: 'Ref', multivalue: true, validation: 'reference' },
    }
  });

  let protocols: ProtocolMap<ProtocolContext>;
  
  beforeEach(() => {
    protocols = new ProtocolMap();
    protocols.set(protocol.name, protocol);
  });

  const getInfra = (overrides = {}) => makeMockInfra({
    protocols,
    config: TEST_ENGINE_CONFIG,
    ...overrides
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should validate multiple commits in a batch', async () => {
    const raw1 = makeRawCommit({ hash: 'abc', trailers: 'Test-id: T-123' });
    const raw2 = makeRawCommit({ hash: 'def', trailers: 'Test-id: INVALID' });

    const infra = getInfra();
    const results = await validateCommits(hydrateAtoms([raw1, raw2], protocols, { includeAllCommits: true }), infra);
    expect(results).toHaveLength(2);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
  });

  it('should orchestrate reference existence check with Discovery', async () => {
    // Mock reference existence check
    vi.mocked(Discovery.findAtomsByIds).mockResolvedValue([]); // Not found
    
    const raw = makeRawCommit({
      hash: 'abc',
      trailers: 'Test-id: T-123\nRef-id: T-456'
    });

    const infra = getInfra();
    const results = await validateCommits(hydrateAtoms([raw], protocols, { includeAllCommits: true }), infra);
    const issues = results[0].issues;
    expect(issues.some(i => i.rule === 'reference-exists')).toBe(true);
    expect(Discovery.findAtomsByIds).toHaveBeenCalled();
  });

  it('should identify atoms when references exist', async () => {
    vi.mocked(Discovery.findAtomsByIds).mockResolvedValue([makeAtom({
        commitHash: 'h1',
        protocols: new Map([['test', { trailers: { 'Test-id': ['T-456'] }, unauthorized: {} }]])
    })]);

    const raw = makeRawCommit({
        hash: 'abc',
        trailers: 'Test-id: T-123\nRef-id: T-456'
    });

    const infra = getInfra();
    const results = await validateCommits(hydrateAtoms([raw], protocols, { includeAllCommits: true }), infra);
    expect(results[0].issues.some(i => i.rule === 'reference-exists')).toBe(false);
  });
});