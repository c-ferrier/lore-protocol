import { beforeEach,describe, expect, it, vi } from 'vitest';

import { ProtocolMap } from '../../../src/engine/core/models/protocol-map.js';
import type { ProtocolContext } from '../../../src/engine/core/types/protocol-definition.js';
import { type QueryOptions } from '../../../src/engine/core/types/query.js';
import { type RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { findAtoms } from '../../../src/engine/shell/orchestrators/discovery.js';
import { makeStubProtocolContext,MOCK_CORE_TRAILERS, TEST_ID_KEY, TEST_PROTOCOL_DEFINITION } from '../../../src/engine/testing.js';
import { type MockedGitClient } from '../../mock-types.js';
import { makeMockGitClient, makeMockInfra } from '../engine-test-utils.js';

describe('Discovery Filtering Parity', () => {
  let git: MockedGitClient;
  let protocols: ProtocolMap<ProtocolContext>;
  let protocol: ProtocolContext;

  beforeEach(() => {
    git = makeMockGitClient();

    protocol = makeStubProtocolContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
    });
    protocols = new ProtocolMap();
    protocols.set(protocol.name, protocol);
  });

  const getInfra = () => makeMockInfra({
      git,
      protocols,
  });

  describe('Discovery Phase (Git Coarse Filtering)', () => {
    it('should always include Atom Discovery Mode patterns (Mock-id sentinel)', async () => {
      const infra = getInfra();
      await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] });
      
      const query = vi.mocked(git.queryStream).mock.calls[0][0];

      // Top level is list of lists
      expect(query.regexPatterns![0].some((p: string) => p.includes(TEST_ID_KEY))).toBe(true);
    });

    it('should generate correct StorageQuery for author and scope', async () => {
      const options = {
        author: 'alice',
        scope: 'auth',
      };
      const infra = getInfra();
      await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] }, options);

      const query = vi.mocked(git.queryStream).mock.calls[0][0];

      expect(query.author).toBe('alice');
      // Scope should be its own AND condition
      expect(query.regexPatterns!.some((set: readonly string[]) => set.some(p => p.includes('^[a-zA-Z]+\\(auth\\):')))).toBe(true);
    });

    it('should generate correct StorageQuery for the "has" trailer filter', async () => {
      const options: QueryOptions = {
        has: 'Constraint',
      };
      const infra = getInfra();
      await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] }, options);
      
      const query = vi.mocked(git.queryStream).mock.calls[0][0];

      // should contain the discovery pattern for Constraint
      expect(query.regexPatterns!.some((set: readonly string[]) => set.some(p => p.includes('Constraint: ')))).toBe(true);
    });

    it('should generate correct StorageQuery for Enum filters (pushdown)', async () => {
      const options: QueryOptions = {
        filters: {
          Confidence: 'high'
        }
      };
      const infra = getInfra();
      await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] }, options);
      
      const query = vi.mocked(git.queryStream).mock.calls[0][0];

      expect(query.regexPatterns!.some((set: readonly string[]) => set.some(p => p.includes('Confidence: high')))).toBe(true);
    });

    it('should generate correct StorageQuery for full-text search (pushdown)', async () => {
      const options: QueryOptions = {
        text: 'bug fix'
      };
      const infra = getInfra();
      await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] }, options);
      
      const query = vi.mocked(git.queryStream).mock.calls[0][0];

      expect(query.regexPatterns!.some((set: readonly string[]) => set.includes('bug fix'))).toBe(true);
    });

    it('should escape regex special characters in scope and id (Security)', async () => {
      const options: QueryOptions = {
        scope: 'auth) | grep (',
      };
      const infra = getInfra();
      await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] }, options);

      const query = vi.mocked(git.queryStream).mock.calls[0][0];

      // Characters should be escaped
      expect(query.regexPatterns!.some((set: readonly string[]) => set.some(p => p.includes('auth\\) \\| grep \\(')))).toBe(true);
    });
  });

  describe('Refinement Phase (Fine Filtering)', () => {
    it('should correctly narrow results even if Git produces false positives', async () => {
      // Mock Git returning two commits, one of which is a false positive
      const commit1: RawCommit = {
        hash: 'h1', date: '2023-01-01', author: 'alice', subject: 'feat: sub', body: 'body',
        trailers: `${TEST_ID_KEY}: aaaaaaaa\nConfidence: high`,
        filesChanged: []
      };
      const commit2: RawCommit = {
        hash: 'h2', date: '2023-01-01', author: 'bob', subject: 'feat: sub', body: 'body',
        trailers: `${TEST_ID_KEY}: bbbbbbbb\nConfidence: low`,
        filesChanged: []
      };

      vi.mocked(git.queryStream).mockImplementation(async function* () { yield* [commit1, commit2]; });

      const infra = getInfra();
      const results = await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] }, { author: 'alice' });

      expect(results).toHaveLength(1);
      expect(results[0].commitHash).toBe('h1');
    });

    it('should correctly refine results for Enums and Has', async () => {
      const commit1: RawCommit = {
        hash: 'h1', date: '2023-01-01', author: 'alice', subject: 's', body: 'b',
        trailers: `${TEST_ID_KEY}: aaaaaaaa\nConfidence: high`,
        filesChanged: []
      };
      const commit2: RawCommit = {
        hash: 'h2', date: '2023-01-01', author: 'alice', subject: 's', body: 'b',
        trailers: `${TEST_ID_KEY}: bbbbbbbb\nConfidence: low`,
        filesChanged: []
      };

      vi.mocked(git.queryStream).mockImplementation(async function* () { yield* [commit1, commit2]; });

      const infra = getInfra();
      const results = await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] }, { author: 'alice', filters: { Confidence: 'high' } });

      expect(results).toHaveLength(1);
      expect(results[0].commitHash).toBe('h1');
    });

    it('should correctly refine results for full-text search', async () => {
      const commit1: RawCommit = {
        hash: 'h1', date: '2023-01-01', author: 'a', subject: 'target word', body: 'b',
        trailers: `${TEST_ID_KEY}: aaaaaaaa`,
        filesChanged: []
      };
      const commit2: RawCommit = {
        hash: 'h2', date: '2023-01-01', author: 'a', subject: 'no match', body: 'b',
        trailers: `${TEST_ID_KEY}: bbbbbbbb`,
        filesChanged: []
      };

      vi.mocked(git.queryStream).mockImplementation(async function* () { yield* [commit1, commit2]; });

      const infra = getInfra();
      const results = await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] }, { text: 'target word' });

      expect(results).toHaveLength(1);
      expect(results[0].commitHash).toBe('h1');
    });
  });

  describe('Integration of Filters', () => {
    it('behaves as an AND operation across different filter types', async () => {
      const commit1: RawCommit = {
        hash: 'h1', date: '2023-01-01', author: 'alice', subject: 'feat(ui): s', body: 'b',
        trailers: `${TEST_ID_KEY}: aaaaaaaa\nConfidence: high`,
        filesChanged: []
      };
      const commit2: RawCommit = {
        hash: 'h2', date: '2023-01-01', author: 'alice', subject: 'feat(auth): s', body: 'b',
        trailers: `${TEST_ID_KEY}: bbbbbbbb\nConfidence: low`,
        filesChanged: []
      };

      vi.mocked(git.queryStream).mockImplementation(async function* () { yield* [commit1, commit2]; });

      const infra = getInfra();
      // Filter by Alice AND scope auth AND Confidence high
      // commit1: Alice, scope ui, high -> FAIL (scope)
      // commit2: Alice, scope auth, low -> FAIL (confidence)
      const results = await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] }, { 
        author: 'alice', 
        scope: 'auth',
        filters: { Confidence: 'high' }
      });

      expect(results).toHaveLength(0);
    });
  });
});
