import { beforeEach,describe, expect, it } from 'vitest';

import { ProtocolMap } from '../../../src/engine/core/types/domain.js';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { makeAtom, makeMockContext, makeRawCommit,TEST_ID_KEY, TEST_PROTOCOL_DEFINITION } from '../../../src/engine/testing.js';
import { makeQueryTarget } from '../../../src/engine/testing.js';
import { makeAtomRepository, makeMockGitClient, makeQueryOptions } from '../engine-test-utils.js';

describe('AtomRepository', () => {
  let gitClient: any;
  let protocolRegistry: ProtocolRegistry;
  let repo: AtomRepository;
  beforeEach(() => {
    gitClient = makeMockGitClient();
    protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(makeMockContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: {
            ...TEST_PROTOCOL_DEFINITION.trailers,
            'Related': { description: 'R', validation: 'reference' } as any,
            'Supersedes': { description: 'S', validation: 'reference' } as any
        }
    }));
    repo = makeAtomRepository({ gitClient, registry: protocolRegistry });
  });
  describe('find', () => {
    it('should return atoms for a file target', async () => {
      const commit = makeRawCommit({ hash: 'a1b2c3d4e5f6', author: 'dev@example.com', filesChanged: ['src/auth.ts'] });
      gitClient.query.mockResolvedValue([commit]);
      gitClient.getCommitsByHashes.mockResolvedValue([commit]);
      const result = await repo.find(makeQueryTarget('src/auth.ts'));
      expect(result).toHaveLength(1);
      expect(result[0].protocols.get('mock')?.trailers[TEST_ID_KEY]?.[0]).toBe('a1b2c3d4');
      expect(result[0].commitHash).toBe(commit.hash);
      expect(result[0].author).toBe('dev@example.com');
      expect(result[0].filesChanged).toEqual(['src/auth.ts']);
    });
    it('should resolve date strings before querying', async () => {
      gitClient.resolveDate.mockImplementation(async (d: string) => new Date(d));
      await repo.find(makeQueryTarget('src/main.ts'), makeQueryOptions({ since: '2025-01-01', until: '2025-01-31' }));
      const queryOpts = gitClient.query.mock.calls[0][0];
      expect(queryOpts.sinceDate).toBeInstanceOf(Date);
      expect(queryOpts.untilDate).toBeInstanceOf(Date);
    });
    it('should filter out non-protocol commits', async () => {
      const commit1 = makeRawCommit({ hash: 'c1', subject: 't' }); // Has trailers
      // Make commit2 explicitly have an empty protocol map after hydration
      const commit2 = makeRawCommit({ hash: 'c2', subject: 't', trailers: 'Junk: junk' }); 
      // The hydrator should skip commit2 because 'Junk' is unauthorized and strict=true
      gitClient.query.mockResolvedValue([commit1, commit2]);
      gitClient.getCommitsByHashes.mockResolvedValue([commit1]); 
      const result = await repo.find(makeQueryTarget('src/main.ts'));
      expect(result).toHaveLength(1);
      expect(result[0].commitHash).toBe('c1');
    });
    it('should pass author filter to GitClient.query', async () => {
      await repo.find(makeQueryTarget('src/main.ts'), makeQueryOptions({ author: 'dev@example.com' }));
      const queryOpts = gitClient.query.mock.calls[0][0];
      expect(queryOpts.author).toBe('dev@example.com');
    });
    it('should apply author filter at the application level (Secondary Pass)', async () => {
      const commit1 = makeRawCommit({ hash: 'c1', author: 'dev@example.com', subject: 't' });
      const commit2 = makeRawCommit({ hash: 'c2', author: 'other@example.com', subject: 't' });
      gitClient.query.mockResolvedValue([commit1, commit2]);
      gitClient.getCommitsByHashes.mockResolvedValue([commit1, commit2]);
      const result = await repo.find(makeQueryTarget('src/main.ts'), makeQueryOptions({ author: 'dev@example.com' }));
      expect(result).toHaveLength(1);
      expect(result[0].commitHash).toBe('c1');
    });
    it('should strip trailers from body when body is exactly the trailer block', async () => {
      const commit = makeRawCommit({ hash: 'c1', subject: 'feat: add login', body: 'Mock-id: a1b2c3d4' });
      gitClient.query.mockResolvedValue([commit]);
      gitClient.getCommitsByHashes.mockResolvedValue([commit]);
      const result = await repo.find(makeQueryTarget('src/main.ts'));
      expect(result[0].body).toBe('');
    });
    it('should not apply limit at the repository level (caller responsibility)', async () => {
      const commit1 = makeRawCommit({ hash: 'c1', subject: 't' });
      const commit2 = makeRawCommit({ hash: 'c2', subject: 't' });
      gitClient.query.mockResolvedValue([commit1, commit2]);
      gitClient.getCommitsByHashes.mockResolvedValue([commit1, commit2]);
      const result = await repo.find(makeQueryTarget('src/main.ts'), makeQueryOptions({ limit: 1 }));
      expect(result).toHaveLength(2); // Repository finds all matching atoms; caller paginates
    });
    it('should return empty array when no commits match', async () => {
      gitClient.query.mockResolvedValue([]);
      const result = await repo.find(makeQueryTarget('src/main.ts'));
      expect(result).toEqual([]);
    });
    it('should handle multi-file targets correctly', async () => {
      await repo.find(makeQueryTarget(['src/main.ts', 'src/auth.ts']));
      const queryOpts = gitClient.query.mock.calls[0][0];
      expect(queryOpts.paths).toEqual(['src/main.ts', 'src/auth.ts']);
    });
  });
  describe('findByLineRange', () => {
    it('should return atoms for a line range target', async () => {
      const commit = makeRawCommit({ id: 'a1b2c3d4', subject: 't' });
      gitClient.blame.mockResolvedValue([{ commitHash: commit.hash, lineNumber: 10, content: 'code' }]);
      gitClient.getCommitsByHashes.mockResolvedValue([commit]);
      const result = await repo.find(makeQueryTarget('src/main.ts:10-20'));
      expect(result).toHaveLength(1);
      expect(result[0].commitHash).toBe(commit.hash);
      expect(gitClient.blame).toHaveBeenCalledWith('src/main.ts', 10, 20);
    });
    it('should deduplicate atoms by identity', async () => {
      const commit1 = makeRawCommit({ hash: 'h1', id: 'aaaa1111', subject: 't' });
      const commit2 = makeRawCommit({ hash: 'h2', id: 'aaaa1111', subject: 't' }); // Same identity, different hash
      gitClient.blame.mockResolvedValue([
        { commitHash: 'h1', lineNumber: 10, content: 'a' },
        { commitHash: 'h2', lineNumber: 11, content: 'b' }
      ]);
      // The FETCH step is where git actually returns the full commits
      // The hydrator deduplicates them
      gitClient.getCommitsByHashes.mockResolvedValue([commit1, commit2]);
      const result = await repo.find(makeQueryTarget('src/main.ts:10-20'));
      expect(result).toHaveLength(1); // Should merge the history of 'aaaa1111'
    });
  });
  describe('findById', () => {
    it('should find an atom by its Mock-id', async () => {
      const commit = makeRawCommit({ id: 'a1b2c3d4', subject: 't' });
      gitClient.query.mockResolvedValue([commit]);
      gitClient.getCommitsByHashes.mockResolvedValue([commit]);
      const result = await repo.findById({ id: 'a1b2c3d4' });
      expect(result).toBeDefined();
      expect(result?.commitHash).toBe(commit.hash);
      const query = gitClient.query.mock.calls[0][0];
      expect(query.regexPatterns[0][0]).toBe('^Mock-id: a1b2c3d4$');
    });
    it('should return null if no atom matches the Mock-id', async () => {
      gitClient.query.mockResolvedValue([]);
      const result = await repo.findById({ id: 'a1b2c3d4' });
      expect(result).toBeNull();
    });
    it('should return null for invalid Mock-id format', async () => {
      gitClient.query.mockResolvedValue([]);
      const result = await repo.findById({ id: 'invalid-id' });
      expect(result).toBeNull();
    });
  });
  describe('findByIds', () => {
    it('should find atoms by their Mock-ids', async () => {
      const commit1 = makeRawCommit({ id: 'a1b2c3d4', subject: 't' });
      const commit2 = makeRawCommit({ id: 'b2c3d4e5', subject: 't' });
      gitClient.query.mockResolvedValue([commit1, commit2]);
      gitClient.getCommitsByHashes.mockResolvedValue([commit1, commit2]);
      const results = await repo.findByIds([{ id: 'a1b2c3d4' }, { id: 'b2c3d4e5' }]);
      expect(results).toHaveLength(2);
    });
    it('should return empty array for empty identities', async () => {
      const results = await repo.findByIds([]);
      expect(results).toHaveLength(0);
      expect(gitClient.query).not.toHaveBeenCalled();
    });
    it('should handle multiple protocols correctly', async () => {
        const p1 = makeMockContext({ name: 'P1', version: '1', strict: true, permissive: false, namespace: 'ns1', identityKey: 'P1-id', trailers: { 'P1-id': { description: 'ID', multivalue: false, validation: 'none' } as any } });
        const p2 = makeMockContext({ name: 'P2', version: '1', strict: true, permissive: false, namespace: 'ns2', identityKey: 'P2-id', trailers: { 'P2-id': { description: 'ID', multivalue: false, validation: 'none' } as any } });
        const multiRegistry = new ProtocolRegistry();
        multiRegistry.register(p1);
        multiRegistry.register(p2);
        const multiRepo = makeAtomRepository({ gitClient, registry: multiRegistry });
        const commit1 = makeRawCommit({ trailers: 'ns1: P1-id: aaaa1111', subject: 't' });
        const commit2 = makeRawCommit({ trailers: 'ns2: P2-id: bbbb2222', subject: 't' });
        gitClient.query.mockResolvedValue([commit1, commit2]);
        gitClient.getCommitsByHashes.mockResolvedValue([commit1, commit2]);
        const results = await multiRepo.findByIds([{ id: 'aaaa1111', protocol: 'p1' }, { id: 'bbbb2222', protocol: 'p2' }]);
        expect(results).toHaveLength(2);
    });
  });
  describe('findByCommitHash', () => {
    it('should fetch and parse a single commit', async () => {
      const commit = makeRawCommit({ hash: 'abc12345', subject: 't' });
      gitClient.log.mockResolvedValue([commit]);
      const result = await repo.findByCommitHash('abc12345');
      expect(result).toBeDefined();
      expect(result?.commitHash).toBe('abc12345');
    });
    it('should return null if no commit found', async () => {
      gitClient.log.mockResolvedValue([]);
      const result = await repo.findByCommitHash('missing');
      expect(result).toBeNull();
    });
  });
  describe('findByRange', () => {
    it('should pass the range directly to git log', async () => {
      gitClient.log.mockResolvedValue([]);
      await repo.findByRange('main..HEAD');
      // The first arg to gitClient.log is an array of git arguments
      expect(gitClient.log).toHaveBeenCalledWith(expect.arrayContaining(['main..HEAD']));
    });
  });
  describe('global find', () => {
    it('should return all Mock atoms', async () => {
      const commit1 = makeRawCommit({ hash: 'c1', subject: 't' });
      const commit2 = makeRawCommit({ hash: 'c2', subject: 't' });
      gitClient.query.mockResolvedValue([commit1, commit2]);
      gitClient.getCommitsByHashes.mockResolvedValue([commit1, commit2]);
      const result = await repo.find();
      expect(result).toHaveLength(2);
    });
    it('should pass since option to GitClient.query', async () => {
      gitClient.resolveDate.mockImplementation(async (d: string) => new Date(d));
      await repo.find(undefined, makeQueryOptions({ since: '2025-01-01' }));
      const queryOpts = gitClient.query.mock.calls[0][0];
      expect(queryOpts.sinceDate).toBeDefined();
    });
    it('should pass until option to GitClient.query', async () => {
      gitClient.resolveDate.mockImplementation(async (d: string) => new Date(d));
      await repo.find(undefined, makeQueryOptions({ until: '2025-01-31' }));
      const queryOpts = gitClient.query.mock.calls[0][0];
      expect(queryOpts.untilDate).toBeDefined();
    });
    it('should pass maxCommits option to GitClient.query', async () => {
      await repo.find(undefined, makeQueryOptions({ maxCommits: 50 }));
      const queryOpts = gitClient.query.mock.calls[0][0];
      expect(queryOpts.maxCommits).toBe(50);
    });
  });
  describe('findByScope', () => {
    it('should find atoms matching the scope', async () => {
      const commit1 = makeRawCommit({ subject: 'feat(auth): login', message: 'feat(auth): login\n\nMock-id: abc' });
      const commit2 = makeRawCommit({ subject: 'feat(ui): button', message: 'feat(ui): button\n\nMock-id: def' });
      gitClient.query.mockResolvedValue([commit1, commit2]);
      gitClient.getCommitsByHashes.mockResolvedValue([commit1, commit2]);
      const result = await repo.find(undefined, { scope: 'auth' });
      expect(result).toHaveLength(1);
    });
    it('match scope case-insensitively', async () => {
      const commit = makeRawCommit({ subject: 'feat(AUTH): login', message: 'feat(AUTH): login\n\nMock-id: abc' });
      gitClient.query.mockResolvedValue([commit]);
      gitClient.getCommitsByHashes.mockResolvedValue([commit]);
      const result = await repo.find(undefined, { scope: 'auth' });
      expect(result).toHaveLength(1);
    });
  });
  describe('Multi-Protocol Hydration', () => {
    it('should hydrate an atom with multiple protocol states if claimed by multiple protocols', async () => {
      const p1 = makeMockContext({ name: 'P1', version: '1', strict: true, permissive: false, namespace: 'ns1', identityKey: 'P1-id', trailers: { 'P1-id': { description: 'ID', multivalue: false, validation: 'none' } as any } });
      const p2 = makeMockContext({ name: 'P2', version: '1', strict: true, permissive: false, namespace: 'ns2', identityKey: 'P2-id', trailers: { 'P2-id': { description: 'ID', multivalue: false, validation: 'none' } as any } });
      const localRegistry = new ProtocolRegistry();
      localRegistry.register(p1);
      localRegistry.register(p2);
      const multiRepo = makeAtomRepository({ gitClient, registry: localRegistry });
      const commit = makeRawCommit({ trailers: 'ns1: P1-id: a1\nns2: P2-id: a2', subject: 't' });
      gitClient.query.mockResolvedValue([commit]);
      gitClient.getCommitsByHashes.mockResolvedValue([commit]);
      const result = await multiRepo.find();
      expect(result).toHaveLength(1);
      const protocols = result[0].protocols;
      expect(protocols.has('p1')).toBe(true);
      expect(protocols.has('p2')).toBe(true);
      expect(protocols.get('p1')?.trailers['P1-id']).toEqual(['a1']);
      expect(protocols.get('p2')?.trailers['P2-id']).toEqual(['a2']);
    });
  });
  describe('Recursive Trace Resolution', () => {
    it('should resolve transitive Related links', async () => {
      // Create a chain: h1 (a) -> h2 (b) -> h3 (c)
      const c3 = makeRawCommit({ hash: 'h3', id: 'cccc3333', subject: 't' });
      const c2 = makeRawCommit({ hash: 'h2', id: 'bbbb2222', subject: 't', trailers: `Mock-id: bbbb2222\nRelated: cccc3333` });
      const c1 = makeRawCommit({ hash: 'h1', id: 'aaaa1111', subject: 't', trailers: `Mock-id: aaaa1111\nRelated: bbbb2222` });
      gitClient.query.mockResolvedValue([c2, c3]);
      gitClient.getCommitsByHashes.mockResolvedValue([c2, c3]);
      // Hydrate initial atom manually
      const initial = makeAtom({
          commitHash: 'h1',
          protocols: new ProtocolMap([['mock', { 
              trailers: { 'Mock-id': ['aaaa1111'], 'Related': ['bbbb2222'] },
              unauthorized: {} 
          } as any]])
      });
      const resolved = await repo.resolveFollowLinks([initial], 5);
      expect(resolved).toHaveLength(3);
      expect(resolved.map(a => a.commitHash)).toEqual(['h1', 'h2', 'h3']);
    });
    it('should respect maxDepth in recursive resolution', async () => {
      const c3 = makeRawCommit({ hash: 'h3', id: 'cccc3333', subject: 't' });
      const c2 = makeRawCommit({ hash: 'h2', id: 'bbbb2222', subject: 't', trailers: `Mock-id: bbbb2222\nRelated: cccc3333` });
      gitClient.query.mockResolvedValue([c2, c3]);
      gitClient.getCommitsByHashes.mockResolvedValue([c2, c3]);
      const initial = makeAtom({
          commitHash: 'h1',
          protocols: new ProtocolMap([['mock', { 
              trailers: { 'Mock-id': ['aaaa1111'], 'Related': ['bbbb2222'] },
              unauthorized: {} 
          } as any]])
      });
      // Max depth 1 means we only get the initial + its direct links (c2)
      const resolved = await repo.resolveFollowLinks([initial], 1);
      expect(resolved).toHaveLength(2);
    });
    it('should handle circular references without infinite loop', async () => {
      const c2 = makeRawCommit({ hash: 'h2', id: 'bbbb2222', subject: 't', trailers: `Mock-id: bbbb2222\nRelated: aaaa1111` });
      gitClient.query.mockResolvedValue([c2]);
      gitClient.getCommitsByHashes.mockResolvedValue([c2]);
      const initial = makeAtom({
          commitHash: 'h1',
          protocols: new ProtocolMap([['mock', { 
              trailers: { 'Mock-id': ['aaaa1111'], 'Related': ['bbbb2222'] },
              unauthorized: {} 
          } as any]])
      });
      const resolved = await repo.resolveFollowLinks([initial], 5);
      expect(resolved).toHaveLength(2);
    });
    it('should return empty array for empty input', async () => {
      const resolved = await repo.resolveFollowLinks([], 5);
      expect(resolved).toHaveLength(0);
    });
  });
  describe('Scoped Repositories', () => {
    it('should correctly project multiple successors in a branching scenario', async () => {
      const parent = makeRawCommit({ hash: 'parent', id: 'aaaaaaaa', subject: 't' });
      const child1 = makeRawCommit({ hash: 'c1', id: 'bbbbbbbb', subject: 't', trailers: `Mock-id: bbbbbbbb\nSupersedes: aaaaaaaa` });
      const child2 = makeRawCommit({ hash: 'c2', id: 'cccccccc', subject: 't', trailers: `Mock-id: cccccccc\nSupersedes: aaaaaaaa` });
      gitClient.query.mockResolvedValue([parent, child1, child2]);
      gitClient.getCommitsByHashes.mockResolvedValue([parent, child1, child2]);
      const results = await repo.find();
      const parentAtom = results.find(a => a.commitHash === 'parent');
      const status = parentAtom?.protocols.get('mock')?.supersession;
      expect(status?.superseded).toBe(true);
      expect(status?.supersededBy).toContain('bbbbbbbb');
      expect(status?.supersededBy).toContain('cccccccc');
    });
    it('should demonstrate Contextual Truth Blindness (only sees truth for provided IDs)', async () => {
      const a = makeRawCommit({ hash: 'ha', id: 'aaaa1111', subject: 't' });
      const b = makeRawCommit({ hash: 'hb', id: 'bbbb2222', subject: 't', trailers: `Mock-id: bbbb2222\nSupersedes: aaaa1111` });
      // CASE 1: Query for A only. Repository cannot see B, so it says A is not superseded.
      gitClient.query.mockResolvedValue([a]);
      gitClient.getCommitsByHashes.mockResolvedValue([a]);
      const results1 = await repo.findByIds([{ id: 'aaaa1111' }]);
      expect(results1[0].protocols.get('mock')?.supersession?.superseded).toBe(false);
      // CASE 2: Query for A AND B. Repository sees the link, so it says A IS superseded.
      gitClient.query.mockResolvedValue([a, b]);
      gitClient.getCommitsByHashes.mockResolvedValue([a, b]);
      const results2 = await repo.findByIds([{ id: 'aaaa1111' }, { id: 'bbbb2222' }]);
      expect(results2.find(x => x.commitHash === 'ha')?.protocols.get('mock')?.supersession?.superseded).toBe(true);
    });
  });
  describe('Base Target Fallback', () => {
    it('should use baseTarget when no target is provided', async () => {
      const scopedRepo = makeAtomRepository({ 
          gitClient, 
          registry: protocolRegistry, 
          baseTarget: makeQueryTarget('.')
      });
      gitClient.query.mockResolvedValue([]);
      await scopedRepo.find(); // no explicit target
      const query = gitClient.query.mock.calls[0][0];
      expect(query.paths).toEqual(['.']); // from baseTarget in makeAtomRepository
    });
    it('should override baseTarget when explicit target is provided', async () => {
      const scopedRepo = makeAtomRepository({ 
          gitClient, 
          registry: protocolRegistry, 
          baseTarget: makeQueryTarget('.')
      });
      gitClient.query.mockResolvedValue([]);
      await scopedRepo.find(makeQueryTarget('src/specific.ts'));
      const query = gitClient.query.mock.calls[0][0];
      expect(query.paths).toEqual(['src/specific.ts']); 
    });
  });
});