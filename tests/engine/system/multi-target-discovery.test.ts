import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { GitClient } from '../../../src/engine/services/git-client.js';
import { TrailerParser } from '../../../src/engine/services/trailer-parser.js';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { SearchFilter } from '../../../src/engine/services/search-filter.js';
import { PathResolver } from '../../../src/engine/services/path-resolver.js';
import { NullAtomCache } from '../../../src/engine/services/atom-cache.js';
import { NullQueryCache } from '../../../src/engine/services/query-cache.js';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';

describe('Multi-Target Atom Discovery', () => {
  let testDir: string;
  let gitClient: GitClient;
  let repo: AtomRepository;

  beforeAll(() => {
    testDir = join(process.cwd(), 'temp-multi-target-test');
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    const run = (cmd: string) => execSync(cmd, { cwd: testDir, stdio: 'pipe' });

    run('git init');
    run('git config user.name "Test User"');
    run('git config user.email "test@example.com"');

    // 1. Atom touching fileA
    writeFileSync(join(testDir, 'fileA.ts'), 'A');
    run('git add fileA.ts');
    run('git commit -m "feat(a): atom A\n\nLore-id: 0000000A"');

    // 2. Atom touching fileB
    writeFileSync(join(testDir, 'fileB.ts'), 'B');
    run('git add fileB.ts');
    run('git commit -m "feat(b): atom B\n\nLore-id: 0000000B"');

    // 3. Atom touching BOTH
    writeFileSync(join(testDir, 'fileA.ts'), 'A2');
    writeFileSync(join(testDir, 'fileB.ts'), 'B2');
    run('git add fileA.ts fileB.ts');
    run('git commit -m "feat(ab): atom AB\n\nLore-id: 000000AB"');

    // 4. Atom touching unrelated file
    writeFileSync(join(testDir, 'fileC.ts'), 'C');
    run('git add fileC.ts');
    run('git commit -m "feat(c): atom C\n\nLore-id: 0000000C"');
  });

  beforeEach(() => {
    gitClient = new GitClient(testDir);
    const registry = new ProtocolRegistry();
    registry.register(new Protocol(LoreProtocolDefinition));
    repo = new AtomRepository(
      gitClient,
      new TrailerParser(),
      registry,
      new SearchFilter(registry),
      new PathResolver(testDir, testDir),
      new NullAtomCache(),
      new NullQueryCache()
    );
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should find atoms touching any of the provided targets', async () => {
    const result = await repo.find({ target: ['fileA.ts', 'fileB.ts'] });
    
    // Should find A, B, and AB, but NOT C.
    expect(result).toHaveLength(3);
    const ids = result.map(a => a.protocols.get('lore')?.trailers['Lore-id']?.[0]);
    expect(ids).toContain('0000000A');
    expect(ids).toContain('0000000B');
    expect(ids).toContain('000000AB');
    expect(ids).not.toContain('0000000C');
  });

  it('should return empty array if none of the targets have protocol atoms', async () => {
    const result = await repo.find({ target: ['non-existent.ts'] });
    expect(result).toHaveLength(0);
  });
});
