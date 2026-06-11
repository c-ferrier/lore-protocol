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
  blame(file: string, lineStart: number, lineEnd: number): Promise<readonly BlameLine[]>;
  commit(message: string, options?: CommitOptions): Promise<CommitResult>;
  hasStagedChanges(): Promise<boolean>;
  getRepoRoot(): Promise<string>;
  isInsideRepo(): Promise<boolean>;
  getFilesChanged(commitHashes: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>>;

  /**
   * Universal streaming log. Yields raw structured records as strings.
   */
  getLogStream(
    revisionRange: string, 
    options?: { format?: string; nameOnly?: boolean; additionalArgs?: string[]; stdin?: string }
  ): AsyncIterable<string>;
  /**
   * High-level query stream. Yields raw commits matching criteria.
   */
  queryStream(query: StorageQuery): AsyncIterable<RawCommit>;
  resolveRef(ref: string): Promise<string>;
  resolveDate(dateStr: string): Promise<Date | null>;
  getHeadMessage(): Promise<string>;
}
