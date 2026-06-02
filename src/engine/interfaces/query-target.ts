/**
 * Represents a resolved physical query space (Global, Path, or Line-Range).
 * Encapsulates the logic of how to scope the storage-layer discovery.
 * 
 * DESIGN: This is an "Opaque Handle". It hides the complexity of 
 * path resolution, relative-to-root calculation, and line-range parsing.
 * 
 * SOLID: SRP -- only manages physical target resolution, zero knowledge of filtering.
 */

export interface QueryIdentity {
  readonly id: string;
  readonly protocol?: string;
}

export interface IQueryTarget {
  /** The original user input (e.g. "src/main.ts:10" or ["file1", "file2"]). */
  readonly raw: string | readonly string[];

  /** 
   * The logical target category.
   * - 'global': Full history scan.
   * - 'path': One or more files/directories.
   * - 'line-range': Specific line(s) in a file (uses Blame).
   * - 'identity': Specific protocol identities (ID/Hash).
   */
  readonly type: 'global' | 'path' | 'line-range' | 'identity';

  /** 
   * Returns the array of physical paths relative to the Protocol Root.
   * - Global: []
   * - Scoped Global: ["."]
   * - Path: ["src/auth.ts"]
   */
  getPaths(): readonly string[];

  /**
   * Returns the line-range details if applicable.
   * Note: Git line-range queries (Blame) only support 1 file at a time.
   */
  getLineRange(): { file: string; start: number; end: number } | null;

  /**
   * For 'identity' targets, returns the specific identities to look for.
   */
  getIdentities(): readonly QueryIdentity[];

  /**
   * Returns a stable string representing the target's unique identity for caching.
   */
  getCacheFingerprint(): string;

  /** 
   * Returns true if this target requires the high-latency 'Blame' path.
   */
  isBlameTarget(): boolean;
}
