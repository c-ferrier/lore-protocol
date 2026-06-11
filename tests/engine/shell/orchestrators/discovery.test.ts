import { beforeEach,describe, expect, it, vi } from 'vitest';

import { ProtocolMap } from '../../../../src/engine/core/models/protocol-map.js';
import type { ProtocolContext } from '../../../../src/engine/core/types/protocol-definition.js';
import { calculateDriftBatch, type DiscoveryInfra, findAtomById, findAtoms, findAtomsByIds, resolveFollowLinks } from '../../../../src/engine/shell/orchestrators/discovery.js';
import { 
    makeAtom,
    makeQueryTarget,
    makeRawCommit,
    makeStubProtocolContext,
    TEST_ID_KEY, 
    TEST_PROTOCOL_DEFINITION 
} from '../../../../src/engine/testing.js';
import { type MockedGitClient } from '../../../mock-types.js'; 
import { makeMockGitClient, makeMockInfra, makeQueryOptions } from '../../engine-test-utils.js'; 

describe('Discovery Orchestrator', () => {
  let git: MockedGitClient;
  let protocols: ProtocolMap<ProtocolContext>;

  // Richer protocol definition for relationship tests
  const RICH_DEF = {
      ...TEST_PROTOCOL_DEFINITION,
      trailers: {
          [TEST_ID_KEY]: { description: 'ID', multivalue: false, validation: 'pattern' as const, pattern: '^[0-9a-f]{8}$' },
          'Related': { description: 'Rel', multivalue: true, validation: 'reference' as const },
          'Supersedes': { description: 'Sup', multivalue: true, validation: 'reference' as const },
          'Depends-on': { description: 'Dep', multivalue: true, validation: 'reference' as const }
      }
  };

  beforeEach(() => {
    git = makeMockGitClient();
    protocols = new ProtocolMap();
    const mock = makeStubProtocolContext(RICH_DEF);
    protocols.set('mock', mock);
  });

  function getInfra(overrides: Partial<DiscoveryInfra> = {}) {
    return makeMockInfra({
        git,
        protocols,
        ...overrides
    }) as DiscoveryInfra;
  }

  describe('findAtoms', () => {
    it('should aggregate discovery patterns from all registered protocols', async () => {
      const fred = makeStubProtocolContext({ name: 'Fred', namespace: 'fred', identityKey: 'Fred-id' });
      protocols.set('fred', fred);
      
      const infra = getInfra();
      await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] });
      
      const query = vi.mocked(git.queryStream).mock.calls[0][0];
      const discoverySet = query.regexPatterns![0];
      expect(discoverySet.some(p => p.startsWith('^Mock-id: '))).toBe(true);
      expect(discoverySet.some(p => p.startsWith('^fred:'))).toBe(true);
    });

    it('should return atoms for a file target', async () => {
      const commit = makeRawCommit({ hash: 'unique-h1', author: 'dev@example.com', filesChanged: ['src/auth.ts'] });
      git.query.mockResolvedValue([commit]);
      
      const infra = getInfra();
      const result = await findAtoms(infra, makeQueryTarget('src/auth.ts'));
      
      expect(result).toHaveLength(1);
      expect(result[0].commitHash).toBe(commit.hash);
    });

    it('should resolve date strings before querying', async () => {
      git.resolveDate.mockImplementation(async (d: string) => new Date(d));
      const infra = getInfra();
      await findAtoms(infra, makeQueryTarget('src/main.ts'), makeQueryOptions({ since: '2025-01-01', until: '2025-01-31' }));
      
      const queryOpts = vi.mocked(git.queryStream).mock.calls[0][0];
      expect(queryOpts.sinceDate).toBeInstanceOf(Date);
      expect(queryOpts.untilDate).toBeInstanceOf(Date);
    });

    it('should filter out non-protocol commits', async () => {
      const commit1 = makeRawCommit({ hash: 'c1', subject: 't' }); // Has trailers
      const commit2 = makeRawCommit({ hash: 'c2', subject: 't', trailers: 'Junk: junk' }); 
      
      git.query.mockResolvedValue([commit1, commit2]);

      const infra = getInfra();
      const result = await findAtoms(infra, makeQueryTarget('src/main.ts'));
      expect(result).toHaveLength(1);
      expect(result[0].commitHash).toBe('c1');
    });

    it('should pass author filter to GitClient.query', async () => {
      const infra = getInfra();
      await findAtoms(infra, makeQueryTarget('src/main.ts'), makeQueryOptions({ author: 'dev@example.com' }));
      const queryOpts = vi.mocked(git.queryStream).mock.calls[0][0];
      expect(queryOpts.author).toBe('dev@example.com');
    });

    it('match scope case-insensitively', async () => {
        const commit = makeRawCommit({ subject: 'FEAT(AUTH): LOGIN' });
        git.query.mockResolvedValue([commit]);
        
        const infra = getInfra();
        const result = await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] }, makeQueryOptions({ scope: 'auth' }));
        expect(result).toHaveLength(1);
    });

    it('should apply author filter at the application level (Secondary Pass)', async () => {
      const commit1 = makeRawCommit({ hash: 'c1', author: 'dev@example.com', subject: 't' });
      const commit2 = makeRawCommit({ hash: 'c2', author: 'other@example.com', subject: 't' });
      git.query.mockResolvedValue([commit1, commit2]);

      const infra = getInfra();
      const result = await findAtoms(infra, makeQueryTarget('src/main.ts'), makeQueryOptions({ author: 'dev@example.com' }));
      expect(result).toHaveLength(1);
      expect(result[0].commitHash).toBe('c1');
    });

    it('should handle empty array when no commits match', async () => {
      git.query.mockResolvedValue([]);
      const infra = getInfra();
      const result = await findAtoms(infra, makeQueryTarget('src/main.ts'));
      expect(result).toEqual([]);
    });

    it('should handle multi-file targets correctly', async () => {
      const infra = getInfra();
      await findAtoms(infra, makeQueryTarget(['src/main.ts', 'src/auth.ts']));
      const queryOpts = vi.mocked(git.queryStream).mock.calls[0][0];
      expect(queryOpts.paths).toEqual(['src/main.ts', 'src/auth.ts']);
    });
  });

  describe('findAtoms (Blame Path)', () => {
    it('should return atoms for a line range target', async () => {
      const commit = makeRawCommit({ id: 'a1b2c3d4', subject: 't' });
      git.blame.mockResolvedValue([{ commitHash: commit.hash, lineNumber: 10, content: 'code' }]);
      git.getCommitsByHashes.mockResolvedValue([commit]);

      const infra = getInfra();
      const result = await findAtoms(infra, makeQueryTarget('src/main.ts:10-20'));
      expect(result).toHaveLength(1);
      expect(result[0].commitHash).toBe(commit.hash);
      expect(git.blame).toHaveBeenCalledWith('src/main.ts', 10, 20);
    });
  });

  describe('findAtomById', () => {
    it('should find an atom by its Mock-id', async () => {
      const commit = makeRawCommit({ id: 'a1b2c3d4', subject: 't' });
      git.query.mockResolvedValue([commit]);

      const infra = getInfra();
      const result = await findAtomById(infra, { id: 'a1b2c3d4' });
      expect(result).toBeDefined();
      expect(result?.commitHash).toBe(commit.hash);
    });

    it('should return null if no atom matches the Mock-id', async () => {
      git.query.mockResolvedValue([]);
      const infra = getInfra();
      const result = await findAtomById(infra, { id: 'a1b2c3d4' });
      expect(result).toBeNull();
    });
  });

  describe('findAtomsByIds', () => {
    it('should find atoms by their Mock-ids', async () => {
      const commit1 = makeRawCommit({ id: 'a1b2c3d4', subject: 't' });
      const commit2 = makeRawCommit({ id: 'b2c3d4e5', subject: 't' });
      git.query.mockResolvedValue([commit1, commit2]);

      const infra = getInfra();
      const results = await findAtomsByIds(infra, [{ id: 'a1b2c3d4' }, { id: 'b2c3d4e5' }]);
      expect(results).toHaveLength(2);
    });

    it('should handle multiple protocols correctly', async () => {
        const p1 = makeStubProtocolContext({ name: 'P1', namespace: 'ns1', identityKey: 'P1-id', trailers: { 'P1-id': { description: 'ID', multivalue: false, validation: 'none' } } });
        const p2 = makeStubProtocolContext({ name: 'P2', namespace: 'ns2', identityKey: 'P2-id', trailers: { 'P2-id': { description: 'ID', multivalue: false, validation: 'none' } } });
        
        const protocols = new ProtocolMap<ProtocolContext>();
        protocols.set('p1', p1);
        protocols.set('p2', p2);

        const infra = getInfra({ protocols });
        const commit1 = makeRawCommit({ trailers: 'ns1: P1-id: aaaa1111', subject: 't' });
        const commit2 = makeRawCommit({ trailers: 'ns2: P2-id: bbbb2222', subject: 't' });
        git.query.mockResolvedValue([commit1, commit2]);

        const results = await findAtomsByIds(infra, [{ id: 'aaaa1111', protocol: 'p1' }, { id: 'bbbb2222', protocol: 'p2' }]);
        expect(results).toHaveLength(2);
    });
  });

  describe('resolveFollowLinks', () => {
    it('should resolve transitive Related links', async () => {
      const c3 = makeRawCommit({ hash: 'h3', id: 'cccc3333', subject: 't' });
      const c2 = makeRawCommit({ hash: 'h2', id: 'bbbb2222', subject: 't', trailers: `Mock-id: bbbb2222\nRelated: cccc3333` });
      
      git.query.mockImplementation(async (q) => {
          const patterns = (q.regexPatterns?.[0] || []);
          if (patterns.some(p => p.includes('bbbb2222'))) return [c2];
          if (patterns.some(p => p.includes('cccc3333'))) return [c3];
          return [];
      });

      const initial = makeAtom({
          commitHash: 'h1',
          protocols: new ProtocolMap([['mock', { 
              trailers: { [TEST_ID_KEY]: ['aaaa1111'], 'Related': ['bbbb2222'] },
              unauthorized: {}
          }]])
      });

      const infra = getInfra();
      const resolved = await resolveFollowLinks(infra, [initial], 5);
      expect(resolved).toHaveLength(3);
      const hashes = resolved.map(a => a.commitHash);
      expect(hashes).toContain('h1');
      expect(hashes).toContain('h2');
      expect(hashes).toContain('h3');
    });

    it('should respect maxDepth in recursive resolution', async () => {
      const c3 = makeRawCommit({ hash: 'h3', id: 'cccc3333', subject: 't' });
      const c2 = makeRawCommit({ hash: 'h2', id: 'bbbb2222', subject: 't', trailers: `Mock-id: bbbb2222\nRelated: cccc3333` });
      
      git.query.mockImplementation(async (q) => {
          const p = q.regexPatterns?.[0] || [];
          if (p.some(s => s.includes('bbbb2222'))) return [c2];
          if (p.some(s => s.includes('cccc3333'))) return [c3];
          return [];
      });

      const initial = makeAtom({
          commitHash: 'h1',
          protocols: new ProtocolMap([['mock', { 
              trailers: { [TEST_ID_KEY]: ['aaaa1111'], 'Related': ['bbbb2222'] },
              unauthorized: {}
          }]])
      });

      const infra = getInfra();
      const resolved = await resolveFollowLinks(infra, [initial], 1);
      expect(resolved).toHaveLength(2);
    });

    it('should handle circular references without infinite loop', async () => {
        const id1 = 'aaaaaaaa';
        const id2 = 'bbbbbbbb';
        const c1 = makeRawCommit({ hash: 'h1', id: id1, subject: 't', trailers: `Mock-id: ${id1}\nRelated: ${id2}` });
        const c2 = makeRawCommit({ hash: 'h2', id: id2, subject: 't', trailers: `Mock-id: ${id2}\nRelated: ${id1}` });
        
        git.query.mockImplementation(async (q) => {
            const p = q.regexPatterns?.[0] || [];
            if (p.some(s => s.includes(id1))) return [c1];
            if (p.some(s => s.includes(id2))) return [c2];
            return [];
        });

        const infra = getInfra();
        const initial = makeAtom({ 
            commitHash: 'h1', 
            protocols: new ProtocolMap([['mock', { 
                trailers: { [TEST_ID_KEY]: [id1], 'Related': [id2] },
                unauthorized: {}
            }]])
        });

        const resolved = await resolveFollowLinks(infra, [initial], 10);
        expect(resolved).toHaveLength(2);
    });

    it('should return empty array for empty input', async () => {
        const infra = getInfra();
        const resolved = await resolveFollowLinks(infra, [], 5);
        expect(resolved).toEqual([]);
    });
  });

  describe('calculateDriftBatch', () => {
    it('should calculate accurate drift for multiple atoms in a single pass', async () => {
      const atomA = makeAtom({ commitHash: 'hashA', date: new Date('2023-01-01'), filesChanged: ['src/a.ts'] });
      const atomB = makeAtom({ commitHash: 'hashB', date: new Date('2023-01-05'), filesChanged: ['src/a.ts', 'src/b.ts'] });

      git.getLogStream.mockImplementation(async function* () {
          yield 'c5\nsrc/a.ts'; // Drift for A and B
          yield 'c4\nsrc/b.ts'; // Drift for A and B
          yield 'hashB\nsrc/b.ts'; // Atom B (Start snapshot)
          yield 'c3\nsrc/a.ts'; // Drift for A only
          yield 'c2\nsrc/c.ts'; // Irrelevant
          yield 'hashA\nsrc/a.ts'; // Atom A (Start snapshot)
      });

      const results = await calculateDriftBatch({ git }, [atomA, atomB]);

      const driftA = results.get('hashA');
      const driftB = results.get('hashB');

      expect(driftA?.['src/a.ts']).toBe(2); // c3 and c5
      expect(driftB?.['src/a.ts']).toBe(1); // c5 only
      expect(driftB?.['src/b.ts']).toBe(1); // c4 only
    });

    it('should return an empty map when given an empty atom list', async () => {
      const results = await calculateDriftBatch({ git }, []);
      expect(results.size).toBe(0);
      expect(git.getLogStream).not.toHaveBeenCalled();
    });

    it('should propagate Git errors from the stream', async () => {
      const atom = makeAtom({ commitHash: 'unreachable', date: new Date() });
      git.getLogStream.mockImplementation(async function* () {
          yield* [];
          throw new Error('fatal: reference is not a tree: unreachable');
      });

      await expect(calculateDriftBatch({ git }, [atom])).rejects.toThrow('fatal: reference is not a tree');
    });
  });

  describe('Supersession Projection', () => {
    it('should correctly project multiple successors in a branching scenario', async () => {
      const parent = makeRawCommit({ hash: 'parent', id: 'aaaaaaaa', subject: 't' });
      const child1 = makeRawCommit({ hash: 'c1', id: 'bbbbbbbb', subject: 't', trailers: `Mock-id: bbbbbbbb\nSupersedes: aaaaaaaa` });
      const child2 = makeRawCommit({ hash: 'c2', id: 'cccccccc', subject: 't', trailers: `Mock-id: cccccccc\nSupersedes: aaaaaaaa` });
      
      git.query.mockResolvedValue([child2, child1, parent]);

      const infra = getInfra();
      const results = await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] });
      
      const parentAtom = results.find(a => a.commitHash === 'parent');
      const status = parentAtom?.protocols.get('mock')?.supersession;
      expect(status?.superseded).toBe(true);
      expect(status?.supersededBy).toContain('bbbbbbbb');
      expect(status?.supersededBy).toContain('cccccccc');
    });
  });
});
