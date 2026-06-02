import { resolve, relative, isAbsolute, join } from 'node:path';
import type { IQueryTarget, QueryIdentity } from '../interfaces/query-target.js';
import { ProtocolError } from '../util/errors.js';

/**
 * Configuration for query target resolution.
 */
export interface TargetContext {
  readonly cwd: string;
  readonly protocolRoot: string;
  readonly isScoped: boolean;
}

/**
 * Factory for creating Opaque Query Targets.
 * Encapsulates the "Triple-Root" resolution math (CWD, ProtocolRoot).
 */
export class QueryTargetFactory {
  constructor(private readonly context: TargetContext) {}

  /**
   * Resolves a raw user input into a formal IQueryTarget.
   */
  create(input?: string | readonly string[]): IQueryTarget {
    // 1. Handle Global Target (Empty input or empty array)
    if (!input || (Array.isArray(input) && input.length === 0)) {
      return new QueryTarget(input || '', 'global', this.context.isScoped ? ['.'] : []);
    }

    // 2. Handle Multiple Paths
    if (Array.isArray(input)) {
        const resolvedPaths = input.map(p => this.resolvePhysicalPath(p));
        return new QueryTarget(input, 'path', resolvedPaths);
    }

    // 3. Handle Single String (File or Line-Range)
    if (typeof input === 'string') {
        const lineRangeMatch = /^(.*):(\d+)(?:-(\d+))?$/.exec(input);
        if (lineRangeMatch) {
            const filePath = lineRangeMatch[1];
            const start = parseInt(lineRangeMatch[2], 10);
            const end = lineRangeMatch[3] ? parseInt(lineRangeMatch[3], 10) : start;
            
            const resolvedPath = this.resolvePhysicalPath(filePath);
            return new QueryTarget(input, 'line-range', [resolvedPath], { 
                file: resolvedPath, start, end 
            });
        }
        
        return new QueryTarget(input, 'path', [this.resolvePhysicalPath(input)]);
    }

    // 4. Fallback (Should be unreachable)
    return new QueryTarget('', 'global', []);
  }

  /**
   * Creates a target from one or more logical identities.
   */
  fromIdentities(identities: readonly QueryIdentity[]): IQueryTarget {
    const raw = identities.map(i => i.protocol ? `${i.protocol}/${i.id}` : i.id);
    return new QueryTarget(raw, 'identity', [], null, identities);
  }

  /**
   * Resolves a user-provided path string to a path relative to the Protocol Root.
   * REJECTS: Paths outside the protocol root (security/logical boundary).
   */
  private resolvePhysicalPath(path: string): string {
    // a. Make absolute
    const absolute = isAbsolute(path) ? path : resolve(this.context.cwd, path);
    
    // b. Make relative to protocol root
    let rel = relative(this.context.protocolRoot, absolute);
    
    // c. Boundary Check
    if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new ProtocolError(`Path "${path}" is outside the protocol root "${this.context.protocolRoot}"`, 1);
    }

    // d. POSIX Normalization
    rel = rel.replace(/\\/g, '/');

    // e. Preserve trailing slash for directory targeting
    if (path.endsWith('/') && !rel.endsWith('/')) {
        rel += '/';
    }

    // f. Edge case
    if (rel === '') rel = '.';
    
    return rel;
  }
}

/**
 * Private implementation of IQueryTarget.
 * Hides the data structure from consumers.
 */
class QueryTarget implements IQueryTarget {
  constructor(
    public readonly raw: string | readonly string[],
    public readonly type: 'global' | 'path' | 'line-range' | 'identity',
    private readonly resolvedPaths: readonly string[],
    private readonly lineRange: { file: string; start: number; end: number } | null = null,
    private readonly identities: readonly QueryIdentity[] = []
  ) {}

  getPaths(): readonly string[] {
    return this.resolvedPaths;
  }

  getLineRange(): { file: string; start: number; end: number } | null {
    return this.lineRange;
  }

  getIdentities(): readonly QueryIdentity[] {
    return this.identities;
  }

  getCacheFingerprint(): string {
    switch (this.type) {
      case 'global':
        return this.resolvedPaths.length > 0 ? 'scoped-global:.' : 'global';
      case 'path':
        return `path:${[...this.resolvedPaths].sort().join(',')}`;
      case 'identity':
        const ids = this.identities.map(i => i.protocol ? `${i.protocol}/${i.id}` : i.id);
        return `identity:${ids.sort().join(',')}`;
      case 'line-range':
        return `blame:${this.lineRange?.file}:${this.lineRange?.start}-${this.lineRange?.end}`;
      default:
        return 'unknown';
    }
  }

  isBlameTarget(): boolean {
    return this.type === 'line-range';
  }
}
