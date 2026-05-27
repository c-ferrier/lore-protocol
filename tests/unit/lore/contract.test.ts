import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildLoreCli } from '../../../src/lore/cli-wrapper.js';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

/**
 * LORE CLI CONTRACT TEST (Exhaustive)
 * 
 * This test suite defines the "Contract" between our new decoupled architecture
 * and the original Lore 0.5.0 CLI. 
 * 
 * MANDATE: Every command and option present in Lore 0.5.0 must exist in our 
 * wrapper with EXACT matching descriptions to ensure backward compatibility.
 * 
 * SOURCE OF TRUTH: The LORE_050_STATE constant is a snapshot from the system binary.
 */
const LORE_050_STATE: Record<string, any> = {
  "init": {
    "description": "Initialize .lore/ config in repository",
    "options": []
  },
  "context": {
    "description": "Full lore summary for a code region",
    "options": [
      { "flags": "--scope <name>", "description": "Filter by conventional commit scope instead of path" },
      { "flags": "--follow", "description": "Transitively follow Related/Supersedes/Depends-on links" },
      { "flags": "--all", "description": "Include superseded entries" },
      { "flags": "--author <email>", "description": "Filter by commit author" },
      { "flags": "--limit <n>", "description": "Maximum number of results to display" },
      { "flags": "--max-commits <n>", "description": "Maximum git commits to scan (supersession may be incomplete)" },
      { "flags": "--since <ref>", "description": "Only consider commits since ref/date" }
    ]
  },
  "constraints": {
    "description": "Active constraints for a code region",
    "options": [
      { "flags": "--scope <name>", "description": "Filter by conventional commit scope instead of path" },
      { "flags": "--follow", "description": "Transitively follow Related/Supersedes/Depends-on links" },
      { "flags": "--all", "description": "Include superseded entries" },
      { "flags": "--author <email>", "description": "Filter by commit author" },
      { "flags": "--limit <n>", "description": "Maximum number of results to display" },
      { "flags": "--max-commits <n>", "description": "Maximum git commits to scan (supersession may be incomplete)" },
      { "flags": "--since <ref>", "description": "Only consider commits since ref/date" }
    ]
  },
  "rejected": {
    "description": "Previously rejected alternatives for a code region",
    "options": [
      { "flags": "--scope <name>", "description": "Filter by conventional commit scope instead of path" },
      { "flags": "--follow", "description": "Transitively follow Related/Supersedes/Depends-on links" },
      { "flags": "--all", "description": "Include superseded entries" },
      { "flags": "--author <email>", "description": "Filter by commit author" },
      { "flags": "--limit <n>", "description": "Maximum number of results to display" },
      { "flags": "--max-commits <n>", "description": "Maximum git commits to scan (supersession may be incomplete)" },
      { "flags": "--since <ref>", "description": "Only consider commits since ref/date" }
    ]
  },
  "directives": {
    "description": "Active forward-looking warnings for a code region",
    "options": [
      { "flags": "--scope <name>", "description": "Filter by conventional commit scope instead of path" },
      { "flags": "--follow", "description": "Transitively follow Related/Supersedes/Depends-on links" },
      { "flags": "--all", "description": "Include superseded entries" },
      { "flags": "--author <email>", "description": "Filter by commit author" },
      { "flags": "--limit <n>", "description": "Maximum number of results to display" },
      { "flags": "--max-commits <n>", "description": "Maximum git commits to scan (supersession may be incomplete)" },
      { "flags": "--since <ref>", "description": "Only consider commits since ref/date" }
    ]
  },
  "tested": {
    "description": "Test coverage: what was and was not verified",
    "options": [
      { "flags": "--scope <name>", "description": "Filter by conventional commit scope instead of path" },
      { "flags": "--follow", "description": "Transitively follow Related/Supersedes/Depends-on links" },
      { "flags": "--all", "description": "Include superseded entries" },
      { "flags": "--author <email>", "description": "Filter by commit author" },
      { "flags": "--limit <n>", "description": "Maximum number of results to display" },
      { "flags": "--max-commits <n>", "description": "Maximum git commits to scan (supersession may be incomplete)" },
      { "flags": "--since <ref>", "description": "Only consider commits since ref/date" }
    ]
  },
  "coverage": {
    "description": "Test coverage map (alias for tested)",
    "options": [
      { "flags": "--scope <name>", "description": "Filter by conventional commit scope instead of path" },
      { "flags": "--follow", "description": "Transitively follow Related/Supersedes/Depends-on links" },
      { "flags": "--all", "description": "Include superseded entries" },
      { "flags": "--author <email>", "description": "Filter by commit author" },
      { "flags": "--limit <n>", "description": "Maximum number of results to display" },
      { "flags": "--max-commits <n>", "description": "Maximum git commits to scan (supersession may be incomplete)" },
      { "flags": "--since <ref>", "description": "Only consider commits since ref/date" }
    ]
  },
  "why": {
    "description": "Decision context for a specific line or line range",
    "options": []
  },
  "search": {
    "description": "Search across all lore with filters",
    "options": [
      { "flags": "--confidence <level>", "description": "Filter by confidence: low, medium, high" },
      { "flags": "--scope-risk <level>", "description": "Filter by scope-risk: narrow, moderate, wide" },
      { "flags": "--reversibility <level>", "description": "Filter by reversibility: clean, migration-needed, irreversible" },
      { "flags": "--has <trailer>", "description": "Filter atoms that contain this trailer type" },
      { "flags": "--author <email>", "description": "Filter by commit author" },
      { "flags": "--scope <name>", "description": "Filter by conventional commit scope" },
      { "flags": "--text <query>", "description": "Full-text search across intent, body, and trailer values" },
      { "flags": "--since <ref>", "description": "Only consider commits since ref/date" },
      { "flags": "--until <ref>", "description": "Upper time/revision bound" },
      { "flags": "--all", "description": "Include superseded entries" },
      { "flags": "--limit <n>", "description": "Maximum number of results to display" },
      { "flags": "--max-commits <n>", "description": "Maximum git commits to scan (supersession may be incomplete)" }
    ]
  },
  "log": {
    "description": "Lore-enriched git log",
    "options": [
      { "flags": "--limit <n>", "description": "Maximum number of results to display" },
      { "flags": "--max-commits <n>", "description": "Maximum git commits to scan (supersession may be incomplete)" },
      { "flags": "--since <ref>", "description": "Only consider commits since ref/date" }
    ]
  },
  "stale": {
    "description": "Flag potentially outdated knowledge",
    "options": [
      { "flags": "--older-than <duration>", "description": "Time-based staleness threshold (e.g., 6m, 1y)" },
      { "flags": "--drift <n>", "description": "File drift threshold (commits since atom)" },
      { "flags": "--low-confidence", "description": "Flag low-confidence atoms" }
    ]
  },
  "trace": {
    "description": "Follow decision chain from a starting atom",
    "options": [
      { "flags": "--max-depth <n>", "description": "Maximum BFS traversal depth (default: 10)" }
    ]
  },
  "commit": {
    "description": "Create a Lore-enriched commit",
    "options": [
      { "flags": "--amend", "description": "Amend the last commit" },
      { "flags": "--no-edit", "description": "Keep the existing commit message (use with --amend)" },
      { "flags": "--file <path>", "description": "Read JSON input from file" },
      { "flags": "-i, --interactive", "description": "Interactive mode (guided prompts)" },
      { "flags": "--intent <text>", "description": "Intent line (why the change was made)" },
      { "flags": "--body <text>", "description": "Body (narrative context)" },
      { "flags": "--constraint <text...>", "description": "Constraint trailer value (repeatable)" },
      { "flags": "--rejected <text...>", "description": "Rejected trailer value (repeatable)" },
      { "flags": "--confidence <level>", "description": "Confidence level: low, medium, high" },
      { "flags": "--scope-risk <level>", "description": "Scope-risk level: narrow, moderate, wide" },
      { "flags": "--reversibility <level>", "description": "Reversibility level: clean, migration-needed, irreversible" },
      { "flags": "--directive <text...>", "description": "Directive trailer value (repeatable)" },
      { "flags": "--tested <text...>", "description": "Tested trailer value (repeatable)" },
      { "flags": "--not-tested <text...>", "description": "Not-tested trailer value (repeatable)" },
      { "flags": "--supersedes <id...>", "description": "Supersedes Lore-id (repeatable)" },
      { "flags": "--depends-on <id...>", "description": "Depends-on Lore-id (repeatable)" },
      { "flags": "--related <id...>", "description": "Related Lore-id (repeatable)" }
    ]
  },
  "validate": {
    "description": "Validate commits for Lore protocol compliance",
    "options": [
      { "flags": "--since <ref>", "description": "Validate all commits since ref (e.g., main)" },
      { "flags": "--last <n>", "description": "Validate the last N commits" },
      { "flags": "--strict", "description": "Treat warnings as errors" }
    ]
  },
  "squash": {
    "description": "Merge atoms for squash-merge preparation",
    "options": [
      { "flags": "--intent <text>", "description": "Override the intent line of the merged message" },
      { "flags": "--body <text>", "description": "Override the body of the merged message" }
    ]
  },
  "doctor": {
    "description": "Health check: broken refs, config issues",
    "options": []
  },
  "help": {
    "description": "CLI tool for the Lore protocol -- structured decision context in git commits",
    "options": [
      { "flags": "-V, --version", "description": "output the version number" },
      { "flags": "--json", "description": "Shorthand for --format json" },
      { "flags": "--format <type>", "description": "Output format: text or json (default: \"text\")" },
      { "flags": "--no-color", "description": "Disable colored output" },
      { "flags": "--no-update-notifier", "description": "Disable update notification" }
    ]
  }
};

describe('Lore CLI 0.5.0 Exhaustive Compatibility Contract', () => {
  const testDir = join(tmpdir(), `lore-contract-test-${Date.now()}`);
  const pkgPath = join(testDir, 'package.json');

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(pkgPath, JSON.stringify({ version: '0.5.0' }));
    
    vi.stubGlobal('process', {
      ...process,
      argv: ['node', 'lore'],
      cwd: () => testDir,
    });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('CONTRACT: Global options must match exactly', async () => {
    const { program } = await buildLoreCli();
    const globalExpected = LORE_050_STATE['help'].options;
    
    for (const expected of globalExpected) {
        const flag = expected.flags.split(', ').pop().split(' ')[0];
        const opt = program.options.find(o => o.flags.includes(flag));
        expect(opt, `Global option ${flag} missing`).toBeDefined();
        expect(opt?.description.trim()).toBe(expected.description.trim());
    }
  });

  it('CONTRACT: All commands and their options must match 0.5.0 exactly', async () => {
    const { program } = await buildLoreCli();

    for (const [cmdName, cmdContract] of Object.entries(LORE_050_STATE)) {
      if (cmdName === 'help') continue;

      const cmd = program.commands.find(c => c.name() === cmdName);
      expect(cmd, `Command ${cmdName} missing`).toBeDefined();
      
      expect(cmd?.description().trim(), `Description mismatch for ${cmdName}`).toBe(cmdContract.description);

      const contractOpts = cmdContract.options;
      const visibleOpts = cmd?.options.filter(o => !(o as any).hidden);

      // 1. Check all required options exist and match
      for (const expectedOpt of contractOpts) {
        const flag = expectedOpt.flags.split(', ').pop().split(' ')[0];
        const opt = visibleOpts?.find(o => o.flags.includes(flag));
        
        expect(opt, `Option ${flag} missing or hidden in command ${cmdName}`).toBeDefined();
        expect(opt?.description.trim(), `Option description mismatch for ${cmdName} ${flag}`).toBe(expectedOpt.description);

        const sysShort = expectedOpt.flags.startsWith('-') && expectedOpt.flags.includes(',') 
          ? expectedOpt.flags.split(',')[0] 
          : null;
        if (sysShort) {
            expect(opt?.short, `Short alias mismatch for ${cmdName} ${flag}`).toBe(sysShort);
        }
      }

      // 2. STRICT: Check for unexpected visible options
      const contractFlagNames = new Set(contractOpts.map((o: any) => o.flags.split(', ').pop().split(' ')[0]));
      for (const opt of (visibleOpts || [])) {
          const flag = opt.flags.split(', ').pop().split(' ')[0];
          if (flag === '--help') continue;
          expect(contractFlagNames.has(flag), `Unexpected visible option ${flag} found in command ${cmdName}`).toBe(true);
      }
    }
  });
});
