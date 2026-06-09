import { beforeEach,describe, expect, it, vi } from 'vitest';

import { type RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { makeAtomRepository,makeQueryTarget,makeStubProtocolContext, TEST_PROTOCOL_DEFINITION } from '../../../src/engine/testing.js';
import { makeMockGitClient, MockedGitClient } from '../engine-test-utils.js';
;
;



;

const TEST_ID_KEY = "Mock-id";

describe('AtomRepository Refinement', () => {
  let gitClient: MockedGitClient;
  let repo: AtomRepository;
  let protocolRegistry: ProtocolRegistry;

  beforeEach(() => {
    gitClient = makeMockGitClient();
    protocolRegistry = new ProtocolRegistry();
    
    // Register protocol with 'Related' trailer
    const protocolDef = {
        ...TEST_PROTOCOL_DEFINITION,
        trailers: {
            ...TEST_PROTOCOL_DEFINITION.trailers,
            'Related': {
                description: 'Related reference.',
                multivalue: true,
                validation: 'reference' as const,
                isCore: true
            }
        }
    };
    protocolRegistry.register(makeStubProtocolContext(protocolDef));

    repo = makeAtomRepository({
        gitClient,
        protocolRegistry,
    });
  });

  describe('stripTrailersFromBody (Internal Refinement)', () => {
    it('should remove trailers even with varying whitespace', async () => {
      const trailers = `${TEST_ID_KEY}: 12345678\nConfidence: high`;
      const raw: RawCommit = {
        hash: 'h1',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: sub',
        body: `Main body text.\n\n   ${TEST_ID_KEY}: 12345678  \n Confidence: high \n\n`,
        trailers: trailers,
        filesChanged: [],
      };
      vi.mocked(gitClient.query).mockResolvedValue([raw]);

      const [atom] = await repo.find();
      expect(atom.body).toBe('Main body text.');
    });

    it('should not strip text that looks like a trailer but is in the middle of the body', async () => {
      const trailers = `${TEST_ID_KEY}: 12345678`;
      const raw: RawCommit = {
        hash: 'h1',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: sub',
        body: `This line looks like a trailer:\nConstraint: must be fast\n\nBut the real one is here.\n\n${TEST_ID_KEY}: 12345678`,
        trailers: trailers,
        filesChanged: [],
      };
      vi.mocked(gitClient.query).mockResolvedValue([raw]);

      const [atom] = await repo.find();
      expect(atom.body).toContain('Constraint: must be fast');
      expect(atom.body).not.toContain(`${TEST_ID_KEY}: 12345678`);
    });

    it('should handle empty bodies gracefully', async () => {
      const trailers = `${TEST_ID_KEY}: 12345678`;
      const raw: RawCommit = {
        hash: 'h1',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: sub',
        body: trailers,
        trailers: trailers,
        filesChanged: [],
      };
      vi.mocked(gitClient.query).mockResolvedValue([raw]);

      const [atom] = await repo.find();
      expect(atom.body).toBe('');
    });
  });

  describe('followLinks Integration (The Integrated Pipeline)', () => {
    it('should transitively resolve links when follow: true is passed to find()', async () => {
      const trailersA = `${TEST_ID_KEY}: aaaaaaaa\nRelated: bbbbbbbb`;
      const trailersB = `${TEST_ID_KEY}: bbbbbbbb`;

      const commitA: RawCommit = {
        hash: 'hash-a',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: a',
        body: 'Main body a',
        trailers: trailersA,
        filesChanged: [],
      };
      const commitB: RawCommit = {
        hash: 'hash-b',
        date: '2026-01-02T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: b',
        body: 'Main body b',
        trailers: trailersB,
        filesChanged: [],
      };

      vi.mocked(gitClient.query)
        .mockResolvedValueOnce([commitA])
        .mockResolvedValueOnce([commitB]);

      // Execution: ONE repository call handles everything
      const atoms = await repo.find(makeQueryTarget('file.ts'), { follow: true, maxDepth: 1 });

      expect(atoms).toHaveLength(2);
      const ids = atoms.map(a => a.protocols.get('mock')?.trailers[TEST_ID_KEY]?.[0]);
      expect(ids).toContain('aaaaaaaa');
      expect(ids).toContain('bbbbbbbb');
      
      // Verification: Second call to Git was for the linked ID
      const secondCallQuery = vi.mocked(gitClient.query).mock.calls[1][0];
      expect(secondCallQuery.regexPatterns).toContainEqual(['^Mock-id: bbbbbbbb$']);
    });
  });

  describe('findById Robustness (The "Three Pass" System)', () => {
    it('should correctly discard atoms where the target ID is in the body but trailers have a different ID', async () => {
      const targetId = '11111111';
      const actualId = '22222222';

      const commit: RawCommit = {
        hash: 'h-cross-talk',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: cross talk',
        body: `Some text...\n${TEST_ID_KEY}: ${targetId}\n...more text.`,
        trailers: `${TEST_ID_KEY}: ${actualId}`,
        filesChanged: [],
      };

      vi.mocked(gitClient.query).mockResolvedValue([commit]);

      const result = await repo.findById({ id: targetId });

      expect(result).toBeNull();
    });

    it('should find the atom when trailers match exactly', async () => {
      const targetId = 'aaaaaaaa';
      const commit: RawCommit = {
        hash: 'h-match',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: match',
        body: 'Main body',
        trailers: `${TEST_ID_KEY}: ${targetId}`,
        filesChanged: [],
      };

      vi.mocked(gitClient.query).mockResolvedValue([commit]);

      const result = await repo.findById({ id: targetId });

      expect(result).not.toBeNull();
      expect(result!.protocols.get('mock')?.trailers[TEST_ID_KEY]?.[0]).toBe(targetId);
    });
  });
});