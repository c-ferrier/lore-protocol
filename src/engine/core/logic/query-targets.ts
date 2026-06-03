import { normalizePathToRoot } from './path-resolution.js';
import type { QueryTargetAST, QueryIdentity } from '../types/query.js';

export interface TargetContext {
  readonly cwd: string;
  readonly protocolRoot: string;
  readonly isScoped: boolean;
}

/**
 * Resolves raw user input into a formal QueryTargetAST.
 */
export function createQueryTarget(
  input: string | readonly string[] | undefined, 
  context: TargetContext
): QueryTargetAST {
  // 1. Handle Global Target (Empty input or empty array)
  if (!input || (Array.isArray(input) && input.length === 0)) {
    return {
      raw: input || '',
      type: 'global',
      resolvedPaths: context.isScoped ? ['.'] : []
    };
  }

  // 2. Handle Multiple Paths
  if (Array.isArray(input)) {
      const resolvedPaths = input.map(p => normalizePathToRoot(p, context.cwd, context.protocolRoot));
      return {
          raw: input,
          type: 'path',
          resolvedPaths
      };
  }

  // 3. Handle Single String (File or Line-Range)
  if (typeof input === 'string') {
      const lineRangeMatch = /^(.*):(\d+)(?:-(\d+))?$/.exec(input);
      if (lineRangeMatch) {
          const filePath = lineRangeMatch[1];
          const start = parseInt(lineRangeMatch[2], 10);
          const end = lineRangeMatch[3] ? parseInt(lineRangeMatch[3], 10) : start;
          
          const resolvedPath = normalizePathToRoot(filePath, context.cwd, context.protocolRoot);
          return {
              raw: input,
              type: 'line-range',
              resolvedPaths: [resolvedPath],
              lineRange: { file: resolvedPath, start, end }
          };
      }
      
      return {
          raw: input,
          type: 'path',
          resolvedPaths: [normalizePathToRoot(input, context.cwd, context.protocolRoot)]
      };
  }

  // 4. Fallback
  return {
    raw: '',
    type: 'global',
    resolvedPaths: []
  };
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
  switch (target.type) {
    case 'global':
    case 'path':
    case 'identity':
      return target.resolvedPaths.length > 0 ? ['--', ...target.resolvedPaths] : [];

    case 'line-range':
      if (!target.lineRange) return [];
      return [
        `-L`,
        `${target.lineRange.start},${target.lineRange.end}:${target.lineRange.file}`,
      ];
    default:
      return [];
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
  switch (target.type) {
    case 'global':
      return target.resolvedPaths.length > 0 ? 'scoped-global:.' : 'global';
    case 'path':
      return `path:${[...target.resolvedPaths].sort().join(',')}`;
    case 'identity':
      if (!target.identities) return 'identity:none';
      const ids = target.identities.map(i => i.protocol ? `${i.protocol}/${i.id}` : i.id);
      return `identity:${ids.sort().join(',')}`;
    case 'line-range':
      if (!target.lineRange) return 'blame:none';
      return `blame:${target.lineRange.file}:${target.lineRange.start}-${target.lineRange.end}`;
    default:
      return 'unknown';
  }
}

/**
 * Returns true if this target requires the high-latency 'Blame' path.
 */
export function isBlameTarget(target: QueryTargetAST): boolean {
  return target.type === 'line-range';
}
