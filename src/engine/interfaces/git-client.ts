export interface RawCommit {
  readonly hash: string;
  readonly date: string;
  readonly author: string;
  readonly subject: string;
  readonly body: string;
  readonly trailers: string;
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
  countCommitsSince(path: string, sinceCommitHash: string): Promise<number>;
  resolveRef(ref: string): Promise<string>;
  resolveDate(dateStr: string): Promise<Date | null>;
  getHeadMessage(): Promise<string>;
}
