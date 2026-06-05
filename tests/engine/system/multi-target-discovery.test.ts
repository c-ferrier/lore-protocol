import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach,describe, expect, it } from 'vitest';

import { createQueryTarget } from '../../../src/engine/core/logic/query-targets.js';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { NullQueryCache } from '../../../src/engine/shell/fs/query-cache.js';
import { GitClient } from '../../../src/engine/shell/git/git-client.js';
import { makeProtocol } from '../../../src/engine/testing.js';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';
;
;
;
;
;
;
;

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
    run('git commit -m "feat(a): atom A\n\nLore-id: 0000000a"');

    // 2. Atom touching file B
    writeFileSync(join(testDir, 'fileB.ts'), 'B');
    run('git add fileB.ts');
    run('git commit -m "feat(b): atom B\n\nLore-id: 0000000b"');

    // 3. Atom touching both A and B
    writeFileSync(join(testDir, 'fileA.ts'), 'A2');
    writeFileSync(join(testDir, 'fileB.ts'), 'B2');
    run('git add fileA.ts fileB.ts');
    run('git commit -m "feat(ab): atom AB\n\nLore-id: 000000ab"');

    // 4. Atom touching unrelated file
    writeFileSync(join(testDir, 'fileC.ts'), 'C');
    run('git add fileC.ts');
    run('git commit -m "feat(c): atom C\n\nLore-id: 0000000c"');

  });

  beforeEach(() => {
    gitClient = new GitClient(testDir);
    const registry = new ProtocolRegistry();
    registry.register(makeProtocol(LoreProtocolDefinition));
    
    const context = {
        cwd: testDir,
        protocolRoot: testDir,
        isScoped: false
    };

    repo = new AtomRepository(
      gitClient,
      registry,
      new NullQueryCache(),
      createQueryTarget(undefined, context),
    );
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should find atoms touching any of the provided targets', async () => {
    const context = { cwd: testDir, protocolRoot: testDir, isScoped: false };
    const result = await repo.find(createQueryTarget(['fileA.ts', 'fileB.ts'], context));
    
    // Should find A, B, and AB, but NOT C.
    expect(result).toHaveLength(3);
    const ids = result.map(a => a.protocols.get('lore')?.trailers['Lore-id']?.[0]);
    expect(ids).toContain('0000000a');
    expect(ids).toContain('0000000b');
    expect(ids).toContain('000000ab');
    expect(ids).not.toContain('0000000c');
  });

  it('should return empty array if none of the targets have protocol atoms', async () => {
    const context = { cwd: testDir, protocolRoot: testDir, isScoped: false };
    const result = await repo.find(createQueryTarget(['non-existent.ts'], context));

    expect(result).toHaveLength(0);
  });
});