import { execFile as execFileCb } from 'node:child_process';

import { escapeRegex } from '../../core/logic/regex.js';
import type { BlameLine, CommitOptions, CommitResult, IGitClient, RawCommit, StorageQuery } from '../../interfaces/git-client.js';
import { GIT_CONCURRENCY_LIMIT } from '../../util/constants.js';
import { GitError } from '../../util/errors.js';

/**
 * Git log format string using Git's %xNN hex escape syntax.
 * 
 * Separator Strategy:
 * - Record Separator (%x1E): ASCII 0x1E. Used to delimit separate commit records.
 * - Field Separator (%x1F): ASCII 0x1F (Unit Separator). Used to delimit fields within a single commit.
 * 
 * Fields (in order): 
 * 1. Hash (%H)
 * 2. ISO Date (%aI)
 * 3. Author Name <email> (%an <%ae>)
 * 4. Subject (%s)
 * 5. Body (%b)
 * 6. Trailers (%(trailers:only,unfold))
 * 
 * Note: We use %xNN instead of literal characters in the format string to avoid escaping 
 * issues across different shells and OS environments.
 */
const LOG_FORMAT = '%x1E%H%x1F%aI%x1F%an <%ae>%x1F%s%x1F%b%x1F%(trailers:only,unfold)%x1F';

/**
 * Blame porcelain line pattern.
 * Matches the commit hash at the start of each blame output block.
 */
const BLAME_HASH_PATTERN = /^([0-9a-f]{40})\s/;

/**
 * Real git interaction layer using child_process.execFile.
 *
 * GoF: Adapter -- adapts the volatile git CLI to a stable domain interface.
 * SOLID: DIP -- services depend on IGitClient, not child_process.
 */
export class GitClient implements IGitClient {
  private readonly cwd: string;
  private activeProcesses = 0;
  private readonly queue: Array<() => void> = [];

  constructor(cwd?: string) {
    this.cwd = cwd ?? process.cwd();
  }

  async log(args: readonly string[]): Promise<readonly RawCommit[]> {
    const hasLFlag = args.some(arg => arg.startsWith('-L'));

    const baseArgs = hasLFlag
      ? ['log', ...args]
      : ['log', `--format=${LOG_FORMAT}`, '--name-only', '--relative', ...args];

    const stdout = await this.exec(baseArgs);

    if (hasLFlag) {
      return this.parseLFlagOutput(stdout);
    }

    return this.parseLogOutput(stdout);
  }

  async query(query: StorageQuery): Promise<readonly RawCommit[]> {
    const args: string[] = [];

    // 0. Revision Range (Graph Bounds)
    if (query.revisionRange) {
      args.push(query.revisionRange);
    }

    // 1. Author Filter
    if (query.author) {
      args.push(`--author=${escapeRegex(query.author)}`);
    }

    // 2. Date Filters
    if (query.sinceDate) {
      args.push(`--since=${query.sinceDate.toISOString()}`);
    }

    if (query.untilDate) {
      args.push(`--until=${query.untilDate.toISOString()}`);
    }

    // 3. Physical Limit
    if (query.maxCommits) {
      args.push(`--max-count=${query.maxCommits}`);
    }

    // 4. Regex Patterns (Greps)
    if (query.regexPatterns && query.regexPatterns.length > 0) {
      for (const patternSet of query.regexPatterns) {
          const activePatterns = patternSet.filter(p => p.trim().length > 0);
          if (activePatterns.length === 0) continue;

          if (activePatterns.length === 1) {
              args.push(`--grep=${activePatterns[0]}`);
          } else {
              // OR logic: join with | and wrap in parentheses for safety
              args.push(`--grep=(${activePatterns.join('|')})`);
          }
      }
      
      // If we added any greps, add the control flags
      if (args.some(a => a.startsWith('--grep='))) {
        args.push('--extended-regexp', '--regexp-ignore-case', '--all-match');
      }
    }

    // 5. Scoping Paths
    if (query.paths && query.paths.length > 0) {
      args.push('--', ...query.paths);
    }

    return this.log(args);
  }

  async blame(file: string, lineStart: number, lineEnd: number): Promise<readonly BlameLine[]> {
    const lineRange = lineEnd === -1
      ? `${lineStart},`
      : `${lineStart},${lineEnd}`;

    const stdout = await this.exec([
      'blame',
      '--porcelain',
      `-L`,
      lineRange,
      file,
    ]);

    return this.parseBlameOutput(stdout);
  }

  async commit(message: string, options?: CommitOptions): Promise<CommitResult> {
    const args = ['commit'];
    if (options?.amend) args.push('--amend');
    if (options?.noEdit) {
      args.push('--no-edit');
    } else {
      args.push('-m', message);
    }
    const stdout = await this.exec(args);

    // Extract the commit hash from git commit output.
    // Git outputs something like: [main abc1234] commit message
    const hashMatch = /\[[\w/-]+\s+([0-9a-f]+)\]/.exec(stdout);
    const hash = hashMatch ? hashMatch[1] : '';

    return { hash, success: true, message: stdout };
  }

  async getHeadMessage(): Promise<string> {
    const stdout = await this.exec(['log', '-1', '--format=%B']);
    return stdout.trimEnd();
  }

  async hasStagedChanges(): Promise<boolean> {
    try {
      const stdout = await this.exec(['diff', '--cached', '--name-only']);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  async getRepoRoot(): Promise<string> {
    const stdout = await this.exec(['rev-parse', '--show-toplevel']);
    return stdout.trim();
  }

  async isInsideRepo(): Promise<boolean> {
    try {
      await this.exec(['rev-parse', '--is-inside-work-tree']);
      return true;
    } catch {
      return false;
    }
  }

  async getFilesChanged(commitHashes: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
    if (commitHashes.length === 0) return new Map();

    // Use git log --no-walk --stdin for robust batching that correctly handles root commits.
    // Format: %H (full hash) on its own line, followed by files.
    const stdout = await this.exec([
      'log',
      '--name-only',
      '--format=%H',
      '--no-walk',
      '--stdin',
      '--relative',
    ], commitHashes.join('\n'));

    const result = new Map<string, string[]>();
    const requestedHashes = new Set(commitHashes);
    let currentHash: string | null = null;

    const lines = stdout.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Match the full hash line to anchor the following file list
      if (requestedHashes.has(trimmed)) {
        currentHash = trimmed;
        if (!result.has(currentHash)) {
          result.set(currentHash, []);
        }
        continue;
      }

      if (currentHash) {
        const files = result.get(currentHash)!;
        if (!files.includes(trimmed)) {
          files.push(trimmed);
        }
      }
    }

    return result;
  }

  async getCommitsByHashes(hashes: readonly string[]): Promise<readonly RawCommit[]> {
    if (hashes.length === 0) return [];

    // Using git show with our custom format and --stdin
    const stdout = await this.exec([
      'show',
      `--format=${LOG_FORMAT}`,
      '--name-only',
      '--relative',
      '--stdin',
    ], hashes.join('\n'));

    return this.parseLogOutput(stdout);
  }

  async getFilesChangedSince(commitHash: string): Promise<readonly string[]> {
    const RECORD_SEP = '\x1E';
    const stdout = await this.exec([
      'log',
      '--name-only',
      '--format=%x1E',
      `${commitHash}..HEAD`,
    ]);

    if (!stdout.trim()) return [];

    const files: string[] = [];
    const chunks = stdout.split(RECORD_SEP);
    for (const chunk of chunks) {
        const trimmedChunk = chunk.trim();
        if (!trimmedChunk) continue;
        
        const lines = trimmedChunk.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine) files.push(trimmedLine);
        }
    }
    return files;
  }

  async resolveRef(ref: string): Promise<string> {
    const stdout = await this.exec(['rev-parse', ref]);
    return stdout.trim();
  }

  async resolveDate(dateStr: string): Promise<Date | null> {
    // 1. INTUITIVE: Handle YYYY-MM-DD as LOCAL MIDNIGHT.
    // This fixes Git's quirk where it resolves YYYY-MM-DD to "Now".
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10);
      const month = parseInt(isoMatch[2], 10) - 1; // 0-indexed
      const day = parseInt(isoMatch[3], 10);
      return new Date(year, month, day);
    }

    // 2. FAST: Handle full ISO-8601 natively in JS.
    const jsDate = new Date(dateStr);
    if (!isNaN(jsDate.getTime())) {
      return jsDate;
    }

    // 3. SMART: Resolve commit refs/hashes (Plumbing: show -s)
    try {
      const refTs = await this.exec(['show', '-s', '--format=%at', dateStr]);
      const ts = parseInt(refTs.trim(), 10);
      return !isNaN(ts) ? new Date(ts * 1000) : null;
    } catch {
      // 4. FALLBACK: Relative strings (Git rev-parse)
      try {
        const output = await this.exec(['rev-parse', `--since=${dateStr}`]);
        const tsMatch = output.match(/=(\d+)/);
        const ts = tsMatch ? parseInt(tsMatch[1], 10) : NaN;
        return !isNaN(ts) ? new Date(ts * 1000) : null;
      } catch {
        return null;
      }
    }
  }

  /**
   * Parse the standard git log output with our custom format.
   * Records are separated by double null bytes; fields within a record
   * by single null bytes.
   */
  private parseLogOutput(stdout: string): readonly RawCommit[] {
    if (!stdout.trim()) {
      return [];
    }

    const FIELD_SEP = '\x1F';
    const RECORD_SEP = '\x1E';

    const commits: RawCommit[] = [];
    const chunks = stdout.split(RECORD_SEP);

    for (const chunk of chunks) {
      if (!chunk) continue;

      // Each chunk is: HASH\x1FDATE\x1FAUTHOR\x1FSUBJECT\x1FBODY\x1FTRAILERS\x1F\nFILE1\nFILE2...
      const parts = chunk.split(FIELD_SEP);
      if (parts.length < 7) continue; // 6 metadata fields + 1 files part

      const filesChanged = parts[6]
        .split('\n')
        .map(f => f.trim())
        .filter(f => f.length > 0);

      commits.push({
        hash: parts[0].trim(),
        date: parts[1].trim(),
        author: parts[2].trim(),
        subject: parts[3].trim(),
        body: parts[4].trim(),
        trailers: parts[5].trim(),
        filesChanged
      });
    }

    return commits;
  }

  /**
   * Parse git log -L output, which uses a different format.
   * The -L flag does not support --format, so we parse the default output.
   */
  private parseLFlagOutput(stdout: string): readonly RawCommit[] {
    if (!stdout.trim()) {
      return [];
    }

    const commits: RawCommit[] = [];
    // Split on commit lines -- each commit starts with "commit <hash>"
    const commitBlocks = stdout.split(/(?=^commit [0-9a-f]{40})/m);

    for (const block of commitBlocks) {
      if (!block.trim()) continue;

      const commitMatch = /^commit ([0-9a-f]{40})/.exec(block);
      if (!commitMatch) continue;

      const hash = commitMatch[1];

      const authorMatch = /^Author:\s+.*<(.+?)>/m.exec(block);
      const author = authorMatch ? authorMatch[1] : '';

      const dateMatch = /^Date:\s+(.+)$/m.exec(block);
      const date = dateMatch ? dateMatch[1].trim() : '';

      // The message starts after the header block (after the first blank line)
      const headerEndIndex = block.indexOf('\n\n');
      let subject = '';
      let body = '';
      let trailers = '';

      if (headerEndIndex !== -1) {
        // Everything after the header, but before the diff section
        const diffStart = block.indexOf('\ndiff --git');
        const messageEnd = diffStart !== -1 ? diffStart : block.length;
        const rawMessage = block.slice(headerEndIndex + 2, messageEnd).trim();

        // Undo the 4-space indent git applies to log messages
        const dedented = rawMessage.split('\n').map(l => l.replace(/^ {4}/, '')).join('\n');

        const msgLines = dedented.split('\n');
        subject = msgLines[0] ?? '';

        // Find the trailer block at the end
        const paragraphs = dedented.split(/\n\n+/);
        if (paragraphs.length > 1) {
          const lastParagraph = paragraphs[paragraphs.length - 1];
          const trailerLinePattern = /^[A-Za-z][A-Za-z0-9-]*:\s+/;
          const lastParaLines = lastParagraph.split('\n');
          const hasTrailers = lastParaLines.some(l => trailerLinePattern.test(l));

          if (hasTrailers) {
            trailers = lastParagraph;
            body = paragraphs.slice(1, -1).join('\n\n');
          } else {
            body = paragraphs.slice(1).join('\n\n');
          }
        }
      }

      commits.push({ hash, date, author, subject, body, trailers, filesChanged: [] });
    }

    return commits;
  }

  /**
   * Parse git blame --porcelain output into BlameLine entries.
   */
  private parseBlameOutput(stdout: string): readonly BlameLine[] {
    if (!stdout.trim()) {
      return [];
    }

    const lines = stdout.split('\n');
    const results: BlameLine[] = [];
    let currentHash: string | null = null;
    let currentLineNumber: number | null = null;

    for (const line of lines) {
      // Lines starting with a hash (40 hex chars) start a new blame block
      const hashMatch = BLAME_HASH_PATTERN.exec(line);
      if (hashMatch) {
        currentHash = hashMatch[1];
        // The line format is: <hash> <orig-line> <final-line> [<num-lines>]
        const parts = line.split(/\s+/);
        currentLineNumber = parseInt(parts[2], 10);
        continue;
      }

      // Content line starts with a tab
      if (line.startsWith('\t') && currentHash !== null && currentLineNumber !== null) {
        results.push({
          commitHash: currentHash,
          lineNumber: currentLineNumber,
          content: line.slice(1), // remove leading tab
        });
        currentHash = null;
        currentLineNumber = null;
      }
    }

    return results;
  }

  /**
   * Execute a git command and return stdout.
   * Throws GitError on non-zero exit or other errors.
   */
  private async exec(args: readonly string[], input?: string): Promise<string> {
    // 1. Concurrency Guard: Wait for a slot if we hit the limit
    if (this.activeProcesses >= GIT_CONCURRENCY_LIMIT) {
        await new Promise<void>(resolve => this.queue.push(resolve));
    }

    this.activeProcesses++;

    try {
        // // console.log('EXECUTING:', 'git', args.join(' '));
        return await new Promise((resolve, reject) => {
          const child = execFileCb('git', args as string[], {
            cwd: this.cwd,
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large repos
            encoding: 'utf-8',
          }, (error, stdout, stderr) => {
            if (error) {
              const execError = error as { stderr?: string; code?: number };
              const actualStderr = stderr || execError.stderr || error.message;
              reject(new GitError(`git ${args[0]} failed: ${actualStderr}`));
            } else {
              resolve(stdout);
            }
          });

          if (input !== undefined && child.stdin) {
            child.stdin.write(input);
            child.stdin.end();
          }
        });
    } finally {
        this.activeProcesses--;
        // 2. Release: Trigger the next waiting process
        this.queue.shift()?.();
    }
  }
}
