import type { QueryIdentity, QueryTargetAST, QueryTargetType } from '../types/query.js';
import { normalizePathToRoot } from './path-resolution.js';

export interface TargetContext {
  readonly cwd: string;
  readonly protocolRoot: string;
  readonly isScoped: boolean;
}

/**
 * Resolves raw user input into a formal QueryTargetAST.
 * Standardizes physical scopes (Paths, Revisions, Line-Ranges).
 */
export function createQueryTarget(
  input: string | readonly string[] | undefined, 
  context: TargetContext
): QueryTargetAST {
  const items = Array.isArray(input) ? input : (input ? [input] : []);
  
  // 1. Handle Global Target (Empty input)
  if (items.length === 0) {
    return {
      raw: input || '',
      type: 'global',
      resolvedPaths: context.isScoped ? ['.'] : []
    };
  }

  let revisionRange: string | undefined;
  let lineRange: { file: string; start: number; end: number } | null = null;
  const resolvedPaths: string[] = [];

  // 2. Partition inputs into Scopes and Anchors
  for (const item of items) {
      if (!item) continue;

      // 2a. Line Range (file:line-line)
      const lrMatch = /^(.*):(\d+)(?:-(\d+))?$/.exec(item);
      if (lrMatch) {
          const filePath = lrMatch[1];
          const start = parseInt(lrMatch[2], 10);
          const end = lrMatch[3] ? parseInt(lrMatch[3], 10) : start;
          const resolved = normalizePathToRoot(filePath, context.cwd, context.protocolRoot);
          
          if (!lineRange) {
              lineRange = { file: resolved, start, end };
          }
          resolvedPaths.push(resolved);
          continue;
      }

      // 2b. Git Revision (Range, Hash, or Ref)
      if (!revisionRange && isRevision(item)) {
          revisionRange = item;
          continue;
      }

      // 2c. Path (Default)
      resolvedPaths.push(normalizePathToRoot(item, context.cwd, context.protocolRoot));
  }

  // 3. Resolve Target Type
  let type: QueryTargetType = 'path';
  if (lineRange) {
      type = 'line-range';
  } else if (revisionRange && resolvedPaths.length === 0) {
      type = 'revision';
  } else if (resolvedPaths.length === 0) {
      type = 'global';
      if (context.isScoped) resolvedPaths.push('.');
  }

  return {
    raw: input || '',
    type,
    resolvedPaths,
    lineRange,
    revisionRange
  };
}

/**
 * Heuristic: Checks if a string looks like a Git physical anchor.
 * Context-aware to avoid collisions with relative paths (../).
 */
function isRevision(str: string): boolean {
    // 1. Explicit path indicators (Relative nav)
    if (str.startsWith('../') || str.startsWith('./') || str.includes('/../')) {
        return false;
    }
    
    // 2. Git Range Indicators
    if (str.includes('..')) return true;
    
    // 3. Git Relative Indicators (HEAD~1, HEAD^)
    if (str.includes('~') || str.includes('^')) return true;
    
    // 4. Git Hash (7-40 hex chars)
    if (/^[0-9a-f]{7,40}$/i.test(str)) return true;
    
    return false;
}

/**
 * Creates a target from one or more logical identities.
 */
export function createTargetFromIdentities(identities: readonly QueryIdentity[]): QueryTargetAST {
  const raw = identities.map(i => i.protocol ? `${i.protocol}/${i.id}` : i.id);
  return {
    raw,
    type: 'identity',
    resolvedPaths: [],
    identities
  };
}

/**
 * Convert a QueryTargetAST into git log arguments.
 */
export function getGitLogArgs(target: QueryTargetAST): string[] {
  const args: string[] = [];
  if (target.revisionRange) {
    args.push(target.revisionRange);
  }

  switch (target.type) {
    case 'global':
    case 'path':
    case 'identity':
      if (target.resolvedPaths.length > 0) {
        args.push('--', ...target.resolvedPaths);
      }
      return args;

    case 'line-range':
      if (!target.lineRange) return [];
      return [
        `-L`,
        `${target.lineRange.start},${target.lineRange.end}:${target.lineRange.file}`,
      ];
    default:
      return args;
  }
}

/**
 * Convert a QueryTargetAST into git blame arguments.
 */
export function getGitBlameArgs(target: QueryTargetAST): { file: string; lineStart: number; lineEnd: number } {
  if (target.type === 'line-range' && target.lineRange) {
    return {
      file: target.lineRange.file,
      lineStart: target.lineRange.start,
      lineEnd: target.lineRange.end,
    };
  }

  // For non-line-range targets, blame the whole file (line 1 to end)
  const file = target.resolvedPaths[0] || '.';
  return {
    file,
    lineStart: 1,
    lineEnd: -1, // Sentinel meaning "end of file"
  };
}

/**
 * Returns a stable string representing the target's unique identity for caching.
 */
export function getCacheFingerprint(target: QueryTargetAST): string {
  const revision = target.revisionRange ? `rev:${target.revisionRange}:` : '';
  
  switch (target.type) {
    case 'global':
      return revision + (target.resolvedPaths.length > 0 ? 'scoped-global:.' : 'global');
    case 'path':
      return revision + `path:${[...target.resolvedPaths].sort().join(',')}`;
    case 'identity': {
      if (!target.identities) return revision + 'identity:none';
      const ids = target.identities.map(i => i.protocol ? `${i.protocol}/${i.id}` : i.id);
      return revision + `identity:${ids.sort().join(',')}`;
    }
    case 'line-range':
      if (!target.lineRange) return revision + 'blame:none';
      return revision + `blame:${target.lineRange.file}:${target.lineRange.start}-${target.lineRange.end}`;
    default:
      return revision + 'unknown';
  }
}

/**
 * Returns true if this target requires the high-latency 'Blame' path.
 */
export function isBlameTarget(target: QueryTargetAST): boolean {
  return target.type === 'line-range';
}
