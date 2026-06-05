import { beforeEach,describe, expect, it, vi } from 'vitest';

import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { makeAtom, makeMockContext, makeProtocolRegistry, makeRawCommit } from '../../../src/engine/testing.js';
import { makeAtomRepository, makeMockGitClient, makeMockQueryCache } from '../engine-test-utils.js';

describe('AtomRepository Optimization', () => {
    it('should be defined', () => {
        expect(AtomRepository).toBeDefined();
    });
});
