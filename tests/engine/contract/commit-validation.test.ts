import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateCommits } from '../../../src/engine/shell/orchestrators/validation.js';
import { 
    makeMockGitClient, 
    makeMockProtocolRegistry, 
    makeMockAtomRepository,
    makeRawCommit,
    TEST_ENGINE_CONFIG,
    createProtocolContext,
    makeProtocol
} from '../engine-test-utils.js';

describe('Commit Validation (Shell Orchestrator)', () => {
  const protocol = createProtocolContext({
    name: 'Test',
    version: '1.0',
    identityKey: 'Test-id',
    trailers: {
      'Test-id': { validation: 'pattern', pattern: '^T-\\d+$' } as any,
      'Ref-id': { validation: 'reference' } as any,
    }
  });

  let registry: any;
  let mockAtomRepo: any;
  
  beforeEach(() => {
    registry = makeMockProtocolRegistry([protocol]);
    mockAtomRepo = makeMockAtomRepository();
  });

  const getDeps = () => ({
    atomRepository: mockAtomRepo,
    config: TEST_ENGINE_CONFIG,
    protocolRegistry: registry
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should validate multiple commits in a batch', async () => {
    const raw1 = makeRawCommit({ hash: 'abc', trailers: 'Test-id: T-123' });
    const raw2 = makeRawCommit({ hash: 'def', trailers: 'Test-id: INVALID' });

    const results = await validateCommits([raw1, raw2], getDeps());
    expect(results).toHaveLength(2);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
  });

  it('should orchestrate reference existence check with AtomRepository', async () => {
    // Mock reference existence check
    mockAtomRepo.findByIds.mockResolvedValue([]); // Not found
    
    const raw = makeRawCommit({
      hash: 'abc',
      trailers: 'Test-id: T-123\nRef-id: T-456'
    });

    const results = await validateCommits([raw], getDeps());
    const issues = results[0].issues;
    expect(issues.some(i => i.rule === 'reference-exists')).toBe(true);
    expect(mockAtomRepo.findByIds).toHaveBeenCalled();
  });

  it('should identify atoms when references exist', async () => {
    mockAtomRepo.findByIds.mockResolvedValue([{
        commitHash: 'h1',
        protocols: new Map([['test', { trailers: { 'Test-id': ['T-456'] }, unauthorized: {} }]])
    }]);

    const raw = makeRawCommit({
        hash: 'abc',
        trailers: 'Test-id: T-123\nRef-id: T-456'
    });

    const results = await validateCommits([raw], getDeps());
    expect(results[0].issues.some(i => i.rule === 'reference-exists')).toBe(false);
  });
});
