import { beforeEach,describe, expect, it } from 'vitest';

import { ProtocolMap } from '../../src/core/models/protocol-map.js';
import { type RawCommit } from '../../src/interfaces/git-client.js';
import { findAtomById,findAtoms } from '../../src/shell/orchestrators/discovery.js';
import { makeQueryTarget,makeStubProtocolContext, type ProtocolContext,TEST_PROTOCOL_DEFINITION } from '../../src/testing.js';
import { makeMockGitClient, makeMockInfra } from '../engine-test-utils.js';
import { type MockedGitClient } from '../mock-types.js';

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
      git.queryStream.mockImplementation(async function* () { yield* [raw]; });

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
      git.queryStream.mockImplementation(async function* () { yield* [raw]; });

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
      git.queryStream.mockImplementation(async function* () { yield* [raw]; });

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

      git.queryStream
        .mockImplementationOnce(async function* () { yield commitA; })
        .mockImplementationOnce(async function* () { yield commitB; });

      const infra = makeMockInfra({ git, protocols });
      // Execution: ONE repository call handles everything
      const atoms = await findAtoms(infra, makeQueryTarget('file.ts'), { follow: true, maxDepth: 1 });

      expect(atoms).toHaveLength(2);
      const ids = atoms.map(a => a.protocols.get('mock')?.trailers[TEST_ID_KEY]?.[0]);
      expect(ids).toContain('aaaaaaaa');
      expect(ids).toContain('bbbbbbbb');
      
      // Verification: Second call to Git was for the linked ID
      const secondCallQuery = git.queryStream.mock.calls[1][0];
      expect(secondCallQuery.regexPatterns).toContainEqual(['^Mock-id: bbbbbbbb\\s*$']);
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

      git.queryStream.mockImplementation(async function* () { yield* [commit]; });

      const infra = makeMockInfra({ git, protocols });
      const result = await findAtomById(infra, { protocol: 'mock', id: targetId });

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

      git.queryStream.mockImplementation(async function* () { yield* [commit]; });

      const infra = makeMockInfra({ git, protocols });
      const result = await findAtomById(infra, { protocol: 'mock', id: targetId });

      expect(result).not.toBeNull();
      expect(result!.protocols.get('mock')?.trailers[TEST_ID_KEY]?.[0]).toBe(targetId);
    });
  });
});