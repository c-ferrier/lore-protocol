import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

/**
 * LORE OUTPUT PARITY TESTS
 * 
 * These tests compare the output of the current local build against the
 * globally installed Lore 0.5.0 binary.
 * 
 * We use a deterministic, temporary Git repository to ensure consistent
 * results across test runs and environments.
 */
describe('Lore CLI Output Parity (v0.5.0 vs Local)', () => {
  const sandboxDir = join(tmpdir(), `lore-parity-sandbox-${Date.now()}`);
  const binPath = join(process.cwd(), 'bin', 'lore.js');

  function execLocal(cmd: string, args: string[] = []) {
    try {
      return execSync(`node ${binPath} ${cmd} ${args.join(' ')}`, {
        cwd: sandboxDir,
        encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' }
      });
    } catch (e: any) {
      return e.stdout?.toString() || e.message;
    }
  }

  function execSystem(cmd: string, args: string[] = []) {
    try {
      return execSync(`lore ${cmd} ${args.join(' ')}`, {
        cwd: sandboxDir,
        encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' }
      });
    } catch (e: any) {
      return e.stdout?.toString() || e.message;
    }
  }

  function commit(message: string, date: string, trailers: Record<string, string[]> = {}) {
    const trailerString = Object.entries(trailers)
      .map(([key, values]) => values.map(v => `${key}: ${v}`).join('\n'))
      .join('\n');
    
    const fullMessage = trailerString ? `${message}\n\n${trailerString}` : message;
    
    const env = {
        GIT_AUTHOR_NAME: "Test Author",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: "Test Author",
        GIT_COMMITTER_EMAIL: "test@example.com",
        GIT_COMMITTER_DATE: date
    };

    writeFileSync(join(sandboxDir, 'README.md'), `${message}\n`, { flag: 'a' });
    execSync('git add README.md', { cwd: sandboxDir });
    execSync(`git commit -m "${fullMessage}"`, { cwd: sandboxDir, env: { ...process.env, ...env } });
  }

  beforeAll(() => {
    // 0. Ensure fresh build for local parity
    execSync('npm run build', { cwd: process.cwd(), stdio: 'ignore' });

    // 1. Create sandbox
    mkdirSync(sandboxDir, { recursive: true });
    
    // 2. Init Git and Lore
    execSync('git init -b main', { cwd: sandboxDir });
    execSync('git config user.name "Test Author"', { cwd: sandboxDir });
    execSync('git config user.email "test@example.com"', { cwd: sandboxDir });
    
    // Use system binary to initialize (.lore only, no .atom)
    // This tests our ability to handle legacy environments
    execSystem('init');

    // 3. Populate history deterministically
    commit("Initial commit", "2023-01-01T12:00:00Z");

    // Atom A: Basic trailers
    commit("Add feature X", "2023-01-02T12:00:00Z", {
        "Lore-id": ["aaaa1111"],
        "Constraint": ["Must be fast"],
        "Tested": ["Unit tests passed"]
    });

    // Atom B: Supersedes A
    commit("Improve feature X", "2023-01-03T12:00:00Z", {
        "Lore-id": ["bbbb2222"],
        "Supersedes": ["aaaa1111"],
        "Constraint": ["Must be faster"],
        "Confidence": ["high"]
    });

    // Atom C: Relationships
    commit("Add feature Y", "2023-01-04T12:00:00Z", {
        "Lore-id": ["cccc3333"],
        "Related": ["bbbb2222"],
        "Depends-on": ["bbbb2222"],
        "Scope-risk": ["moderate"],
        "Reversibility": ["clean"]
    });

    // Atom D: Pivots and Warnings
    commit("Pivot on feature Z", "2023-01-05T12:00:00Z", {
        "Lore-id": ["dddd4444"],
        "Rejected": ["Alternative Z1 | Too expensive"],
        "Directive": ["[until:2024] Audit usage daily"]
    });

    // Drift trigger: modify file without lore
    writeFileSync(join(sandboxDir, 'README.md'), "Drifted content\n", { flag: 'a' });
    execSync('git add README.md', { cwd: sandboxDir });
    execSync('git commit -m "Drift commit"', { 
        cwd: sandboxDir, 
        env: { ...process.env, GIT_AUTHOR_DATE: "2023-01-06T12:00:00Z", GIT_COMMITTER_DATE: "2023-01-06T12:00:00Z" } 
    });
  });

  afterAll(() => {
    rmSync(sandboxDir, { recursive: true, force: true });
  });

  it('PARITY: lore log (Text)', () => {
    const system = execSystem('log', ['--no-color']).trim();
    const local = execLocal('log', ['--no-color']).trim();
    expect(local).toBe(system);
  });

  it('PARITY: lore log (JSON)', () => {
    const system = JSON.parse(execSystem('log', ['--json']));
    const local = JSON.parse(execLocal('log', ['--json']));
    expect(local).toEqual(system);
  });

  it('PARITY: lore search (Text)', () => {
    const system = execSystem('search', ['--text', 'feature', '--no-color']).trim();
    const local = execLocal('search', ['--text', 'feature', '--no-color']).trim();
    expect(local).toBe(system);
  });

  it('PARITY: lore context (Text)', () => {
    const system = execSystem('context', ['README.md', '--no-color']).trim();
    const local = execLocal('context', ['README.md', '--no-color']).trim();
    expect(local).toBe(system);
  });

  it('PARITY: lore stale (Text)', () => {
    const system = execSystem('stale', ['--no-color']).trim();
    const local = execLocal('stale', ['--no-color']).trim();
    expect(local).toBe(system);
  });

  it('PARITY: lore trace (Text)', () => {
    const system = execSystem('trace', ['bbbb2222', '--no-color']).trim();
    const local = execLocal('trace', ['bbbb2222', '--no-color']).trim();
    expect(local).toBe(system);
  });

  it('PARITY: lore validate (Text)', () => {
    const system = execSystem('validate', ['HEAD~4..HEAD', '--no-color']).trim();
    const local = execLocal('validate', ['HEAD~4..HEAD', '--no-color']).trim();
    expect(local).toBe(system);
  });

  it('PARITY: lore doctor (Text)', () => {
    const system = execSystem('doctor', ['--no-color']).trim();
    const local = execLocal('doctor', ['--no-color']).trim();
    
    // Doctor output contains paths and counts which vary.
    const normalize = (s: string) => s
        .replace(/All \d+ Lore-ids/g, 'All X Lore-ids')
        .replace(/\/tmp\/lore-parity-sandbox-\d+/g, '/tmp/sandbox')
        .replace(/Found and parsed .*/g, 'Found and parsed sandbox config')
        .replace(/Config file: .*/g, 'Config file: normalized');
    
    expect(normalize(local)).toBe(normalize(system));
  });

  it('PARITY: lore squash (Raw)', () => {
    const system = execSystem('squash', ['HEAD~2..HEAD']).trim();
    const local = execLocal('squash', ['HEAD~2..HEAD']).trim();
    
    const normalize = (s: string) => s.replace(/Lore-id: [0-9a-f]{8}/g, 'Lore-id: deterministic');
    expect(normalize(local)).toBe(normalize(system));
  });
});
