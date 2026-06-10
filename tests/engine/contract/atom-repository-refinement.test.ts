import { beforeEach,describe, expect, it, vi } from 'vitest';

import { ProtocolMap } from '../../../src/engine/core/models/protocol-map.js';
import { type RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { findAtomById,findAtoms } from '../../../src/engine/shell/orchestrators/discovery.js';
import { makeQueryTarget,makeStubProtocolContext, type ProtocolContext,TEST_PROTOCOL_DEFINITION } from '../../../src/engine/testing.js';
import { type MockedGitClient } from '../../mock-types.js';
import { makeMockGitClient, makeMockInfra } from '../engine-test-utils.js';

const TEST_ID_KEY = "Mock-id";

describe('Discovery Refinement', () => {
  let git: MockedGitClient;
  let protocols: ProtocolMap<ProtocolContext>;

  beforeEach(() => {
    git = makeMockGitClient();
    protocols = new ProtocolMap();
    
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
    const protocol = makeStubProtocolContext(protocolDef);
    protocols.set(protocol.name, protocol);
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
      vi.mocked(git.query).mockResolvedValue([raw]);

      const infra = makeMockInfra({ git, protocols });
      const [atom] = await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] });
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
      vi.mocked(git.query).mockResolvedValue([raw]);

      const infra = makeMockInfra({ git, protocols });
      const [atom] = await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] });
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
      vi.mocked(git.query).mockResolvedValue([raw]);

      const infra = makeMockInfra({ git, protocols });
      const [atom] = await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] });
      expect(atom.body).toBe('');
    });
  });

  describe('followLinks Integration (The Integrated Pipeline)', () => {
    it('should transitively resolve links when follow: true is passed to findAtoms()', async () => {
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

      vi.mocked(git.query)
        .mockResolvedValueOnce([commitA])
        .mockResolvedValueOnce([commitB]);

      const infra = makeMockInfra({ git, protocols });
      // Execution: ONE repository call handles everything
      const atoms = await findAtoms(infra, makeQueryTarget('file.ts'), { follow: true, maxDepth: 1 });

      expect(atoms).toHaveLength(2);
      const ids = atoms.map(a => a.protocols.get('mock')?.trailers[TEST_ID_KEY]?.[0]);
      expect(ids).toContain('aaaaaaaa');
      expect(ids).toContain('bbbbbbbb');
      
      // Verification: Second call to Git was for the linked ID
      const secondCallQuery = vi.mocked(git.query).mock.calls[1][0];
      expect(secondCallQuery.regexPatterns).toContainEqual(['^Mock-id: bbbbbbbb$']);
    });
  });

  describe('findAtomById Robustness (The "Three Pass" System)', () => {
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

      vi.mocked(git.query).mockResolvedValue([commit]);

      const infra = makeMockInfra({ git, protocols });
      const result = await findAtomById(infra, { id: targetId });

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

      vi.mocked(git.query).mockResolvedValue([commit]);

      const infra = makeMockInfra({ git, protocols });
      const result = await findAtomById(infra, { id: targetId });

      expect(result).not.toBeNull();
      expect(result!.protocols.get('mock')?.trailers[TEST_ID_KEY]?.[0]).toBe(targetId);
    });
  });
});