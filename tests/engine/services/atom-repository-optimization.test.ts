import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { makeAtom, makeMockContext, makeProtocolRegistry, makeRawCommit } from '../../../src/engine/testing.js';
import { makeAtomRepository, makeMockGitClient, makeMockQueryCache } from '../engine-test-utils.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('AtomRepository Optimization', () => {
    it('should be defined', () => {
        expect(AtomRepository).toBeDefined();
    });
});
