export interface RawCommit {
  readonly hash: string;
  readonly date: string;
  readonly author: string;
  readonly subject: string;
  readonly body: string;
  readonly trailers: string;
  readonly filesChanged: readonly string[];
}

export interface StorageQuery {
  readonly revisionRange?: string;
  readonly author?: string;
  readonly sinceDate?: Date;
  readonly untilDate?: Date;
  readonly maxCommits?: number;
  /** 
   * High-level regex patterns structured for boolean logic.
   * Top-level array items are AND'ed (multiple --grep flags).
   * Sub-array items are OR'ed (joined by | within a single --grep flag).
   */
  readonly regexPatterns?: readonly (readonly string[])[];
  /** Scoping paths. Git implementation translates these to -- <paths> suffix. */
  readonly paths?: readonly string[];
}

export interface BlameLine {
  readonly commitHash: string;
  readonly lineNumber: number;
  readonly content: string;
}

export interface CommitResult {
  readonly hash: string;
  readonly success: boolean;
  readonly message: string;
}

export interface CommitOptions {
  readonly amend?: boolean;
  readonly noEdit?: boolean;
}

export interface IGitClient {
  log(args: readonly string[]): Promise<readonly RawCommit[]>;
  query(query: StorageQuery): Promise<readonly RawCommit[]>;
  blame(file: string, lineStart: number, lineEnd: number): Promise<readonly BlameLine[]>;
  commit(message: string, options?: CommitOptions): Promise<CommitResult>;
  hasStagedChanges(): Promise<boolean>;
  getRepoRoot(): Promise<string>;
  isInsideRepo(): Promise<boolean>;
  getFilesChanged(commitHashes: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>>;
  /**
   * Retrieve multiple commit records by their hashes in a single operation.
   * Useful for hydrating results from the query cache.
   */
  getCommitsByHashes(hashes: readonly string[]): Promise<readonly RawCommit[]>;
  /**
   * Universal streaming log. Yields structured records (hash + lines) 
   * for any revision range and format.
   */
  getLogStream(
    revisionRange: string, 
    options?: { format?: string; nameOnly?: boolean; additionalArgs?: string[] }
  ): AsyncIterable<{ hash: string; lines: string[] }>;
  resolveRef(ref: string): Promise<string>;
  resolveDate(dateStr: string): Promise<Date | null>;
  getHeadMessage(): Promise<string>;
}
