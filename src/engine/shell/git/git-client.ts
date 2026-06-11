import { execFile as execFileCb } from 'node:child_process';

import { escapeRegex } from '../../core/logic/regex.js';
import type { BlameLine, CommitOptions, CommitResult, IGitClient, RawCommit, StorageQuery } from '../../interfaces/git-client.js';
import { GIT_CONCURRENCY_LIMIT } from '../../util/constants.js';
import { GitError } from '../../util/errors.js';

/**
 * Robust Record Separator for streaming Git output.
 * Uses a four-byte non-printable sequence to minimize collision risk.
 */
export const GIT_RECORD_SEP = '\x1E\x1E\x1E\x1E';

/**
 * ASCII Field Separator for internal commit record splitting.
 */
export const FIELD_SEP = '\x1F';

/**
 * Combined format for high-speed single-pass log streaming.
 * Includes all metadata fields separated by FIELD_SEP.
 */
const LOG_FORMAT_COMBINED = '%H%x1F%aI%x1F%an <%ae>%x1F%s%x1F%b%x1F%(trailers:only,unfold)%x1F';

/**
 * Legacy log format string for buffered log calls.
 */
const LOG_FORMAT = '%x1E%H%x1F%aI%x1F%an <%ae>%x1F%s%x1F%b%x1F%(trailers:only,unfold)%x1F';

/**
 * Blame porcelain line pattern.
 */
const BLAME_HASH_PATTERN = /^([0-9a-f]{40})\s/;

/**
 * Real git interaction layer using child_process.execFile and spawn.
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
    const args = this.buildLogArgs(query);
    return this.log(args);
  }

  async getCommitsByHashes(hashes: readonly string[]): Promise<readonly RawCommit[]> {
    if (hashes.length === 0) return [];
    
    const results: RawCommit[] = [];
    const stream = this.getLogStream('', {
        format: LOG_FORMAT_COMBINED,
        nameOnly: true,
        stdin: hashes.join('\n'),
        additionalArgs: ['--no-walk']
    });

    for await (const record of stream) {
        // record is already metadata-rich
        const parsed = this.parseLogOutput(GIT_RECORD_SEP + record);
        if (parsed.length > 0) results.push(parsed[0]);
    }
    return results;
  }

  async *queryStream(query: StorageQuery): AsyncIterable<RawCommit> {
    const args = this.buildLogArgs(query);
    const range = query.revisionRange || '';
    
    const stream = this.getLogStream(range, {
        format: LOG_FORMAT_COMBINED,
        additionalArgs: args.filter(a => a !== range),
        nameOnly: true
    });

    for await (const record of stream) {
        const parsed = this.parseLogOutput(GIT_RECORD_SEP + record);
        if (parsed.length > 0) yield parsed[0];
    }
  }

  async *getLogStream(
    revisionRange: string, 
    options: { format?: string; nameOnly?: boolean; additionalArgs?: string[]; stdin?: string } = {}
  ): AsyncIterable<string> {
    const { spawn } = await import('node:child_process');
    
    const format = options.format || '%H';
    const args = ['log', `--format=${GIT_RECORD_SEP}${format}`];
    
    if (revisionRange) {
        args.push(revisionRange);
    }
    
    args.push('--relative');
    if (options.nameOnly) args.push('--name-only');
    if (options.additionalArgs) args.push(...options.additionalArgs);
    if (options.stdin) args.push('--stdin');

    const child = spawn('git', args, { cwd: this.cwd });

    if (options.stdin && child.stdin) {
        child.stdin.write(options.stdin);
        child.stdin.end();
    }

    if (!child.stdout) return;

    let buffer = '';
    for await (const chunk of child.stdout) {
        buffer += chunk.toString();
        const records = buffer.split(GIT_RECORD_SEP);
        
        // Keep the last part in buffer if it's incomplete
        buffer = records.pop() || '';

        for (const record of records) {
            if (!record) continue;
            yield record;
        }
    }

    if (buffer && buffer.trim()) {
        yield buffer;
    }
  }

  async resolveRef(ref: string): Promise<string> {
    const stdout = await this.exec(['rev-parse', ref]);
    return stdout.trim();
  }

  async resolveDate(dateStr: string): Promise<Date | null> {
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10);
      const month = parseInt(isoMatch[2], 10) - 1;
      const day = parseInt(isoMatch[3], 10);
      return new Date(year, month, day);
    }

    const jsDate = new Date(dateStr);
    if (!isNaN(jsDate.getTime())) return jsDate;

    try {
      const refTs = await this.exec(['show', '-s', '--format=%at', dateStr]);
      const ts = parseInt(refTs.trim(), 10);
      return !isNaN(ts) ? new Date(ts * 1000) : null;
    } catch {
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

      if (requestedHashes.has(trimmed)) {
        currentHash = trimmed;
        if (!result.has(currentHash)) result.set(currentHash, []);
        continue;
      }

      if (currentHash) {
        const files = result.get(currentHash)!;
        if (!files.includes(trimmed)) files.push(trimmed);
      }
    }

    return result;
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
    const hashMatch = /\[[\w/-]+\s+([0-9a-f]+)\]/.exec(stdout);
    const hash = hashMatch ? hashMatch[1] : '';
    return { hash, success: true, message: stdout };
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

  private buildLogArgs(query: StorageQuery): string[] {
    const args: string[] = [];
    if (query.revisionRange) args.push(query.revisionRange);
    if (query.author) args.push(`--author=${escapeRegex(query.author)}`);
    if (query.sinceDate) args.push(`--since=${query.sinceDate.toISOString()}`);
    if (query.untilDate) args.push(`--until=${query.untilDate.toISOString()}`);
    if (query.maxCommits) args.push(`--max-count=${query.maxCommits}`);

    if (query.regexPatterns && query.regexPatterns.length > 0) {
      for (const patternSet of query.regexPatterns) {
          const activePatterns = patternSet.filter(p => p.trim().length > 0);
          if (activePatterns.length === 0) continue;
          if (activePatterns.length === 1) {
              args.push(`--grep=${activePatterns[0]}`);
          } else {
              args.push(`--grep=(${activePatterns.join('|')})`);
          }
      }
      if (args.some(a => a.startsWith('--grep='))) {
        args.push('--extended-regexp', '--regexp-ignore-case', '--all-match');
      }
    }

    if (query.paths && query.paths.length > 0) args.push('--', ...query.paths);
    return args;
  }

  private parseLogOutput(stdout: string): readonly RawCommit[] {
    if (!stdout.trim()) return [];

    const commits: RawCommit[] = [];
    const chunks = stdout.split(GIT_RECORD_SEP);

    for (const chunk of chunks) {
      if (!chunk) continue;
      // Note: Parts may start with a FIELD_SEP if the hash was already removed by getLogStream reconstruction
      // But parseLogOutput is also used for legacy log calls where the hash IS there.
      const parts = chunk.split(FIELD_SEP);
      if (parts.length < 6) continue;

      commits.push({
        hash: parts[0].trim(),
        date: parts[1].trim(),
        author: parts[2].trim(),
        subject: parts[3].trim(),
        body: parts[4].trimEnd(),
        trailers: parts[5].trim(),
        filesChanged: parts.length > 6 ? parts[6].split('\n').map(f => f.trim()).filter(f => f.length > 0) : []
      });
    }
    return commits;
  }

  private parseLFlagOutput(stdout: string): readonly RawCommit[] {
    if (!stdout.trim()) return [];
    const commits: RawCommit[] = [];
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

      const headerEndIndex = block.indexOf('\n\n');
      let subject = '';
      let body = '';
      let trailers = '';

      if (headerEndIndex !== -1) {
        const diffStart = block.indexOf('\ndiff --git');
        const messageEnd = diffStart !== -1 ? diffStart : block.length;
        const rawMessage = block.slice(headerEndIndex + 2, messageEnd).trim();
        const dedented = rawMessage.split('\n').map(l => l.replace(/^ {4}/, '')).join('\n');
        const msgLines = dedented.split('\n');
        subject = msgLines[0] ?? '';

        const paragraphs = dedented.split(/\n\n+/);
        if (paragraphs.length > 1) {
          const lastParagraph = paragraphs[paragraphs.length - 1];
          const trailerLinePattern = /^[A-Za-z][A-Za-z0-9-]*:\s+/;
          if (lastParagraph.split('\n').some(l => trailerLinePattern.test(l))) {
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

  private parseBlameOutput(stdout: string): readonly BlameLine[] {
    if (!stdout.trim()) return [];
    const lines = stdout.split('\n');
    const results: BlameLine[] = [];
    let currentHash: string | null = null;
    let currentLineNumber: number | null = null;

    for (const line of lines) {
      const hashMatch = BLAME_HASH_PATTERN.exec(line);
      if (hashMatch) {
        currentHash = hashMatch[1];
        currentLineNumber = parseInt(line.split(/\s+/)[2], 10);
        continue;
      }
      if (line.startsWith('\t') && currentHash !== null && currentLineNumber !== null) {
        results.push({ commitHash: currentHash, lineNumber: currentLineNumber, content: line.slice(1) });
        currentHash = null;
        currentLineNumber = null;
      }
    }
    return results;
  }

  private async exec(args: readonly string[], input?: string): Promise<string> {
    if (this.activeProcesses >= GIT_CONCURRENCY_LIMIT) {
        await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.activeProcesses++;
    try {
        return await new Promise((resolve, reject) => {
          const child = execFileCb('git', args as string[], {
            cwd: this.cwd,
            maxBuffer: 10 * 1024 * 1024,
            encoding: 'utf-8',
          }, (error, stdout, stderr) => {
            if (error) {
              const execError = error as { stderr?: string; code?: number };
              reject(new GitError(`git ${args[0]} failed: ${stderr || execError.stderr || error.message}`));
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
        this.queue.shift()?.();
    }
  }
}
