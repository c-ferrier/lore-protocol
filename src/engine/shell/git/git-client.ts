import { execFile as execFileCb } from 'node:child_process';

import { escapeRegex } from '../../core/logic/regex.js';
import type { BlameLine, CommitOptions, CommitResult, IGitClient, RawCommit, StorageQuery } from '../../interfaces/git-client.js';
import { GIT_CONCURRENCY_LIMIT } from '../../util/constants.js';
import { GitError } from '../../util/errors.js';

/**
 * Robust Record Separator for streaming Git output.
 * Uses a four-byte sequence that is extremely unlikely to appear in commit messages.
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
const LOG_FORMAT_COMBINED = `%H${FIELD_SEP}%aI${FIELD_SEP}%an <%ae>${FIELD_SEP}%s${FIELD_SEP}%b${FIELD_SEP}%(trailers:only,unfold)${FIELD_SEP}`;

/**
 * Real git interaction layer using child_process.execFile and spawn.
 */
export class GitClient implements IGitClient {
  private static readonly BLAME_HASH_PATTERN = /^([0-9a-f]{40})\s/;
  private readonly cwd: string;
  private activeProcesses = 0;
  private readonly queue: Array<() => void> = [];

  constructor(cwd?: string) {
    this.cwd = cwd ?? process.cwd();
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
        if (!record) continue;
        const parts = record.split(FIELD_SEP);

        if (parts.length >= 6) {
            yield {
                hash: parts[0].trim(),
                date: parts[1].trim(),
                author: parts[2].trim(),
                subject: parts[3].trim(),
                body: parts[4].trimEnd(),
                trailers: parts[5].trim(),
                filesChanged: parts.length > 6 
                    ? parts[6].split('\n').map(f => f.trim()).filter(f => f.length > 0) 
                    : []
            };
        }
    }
  }

  async filterAliveHashes(hashes: readonly string[], ref: string = 'HEAD'): Promise<string[]> {
      if (hashes.length === 0) return [];
      
      const stdout = await this.exec(
          ['rev-list', '--no-walk', '--stdin', '--ignore-missing', ref],
          hashes.join('\n')
      );
      
      return stdout.trim().split('\n').map(h => h.trim()).filter(h => h.length > 0);
  }

  async *getLogStream(
    revisionRange: string, 
    options: { format?: string; nameOnly?: boolean; additionalArgs?: string[]; stdin?: string } = {}
  ): AsyncIterable<string> {
    const { spawn } = await import('node:child_process');
    
    // We use %xHH escape sequences so Git expands the sentinel characters correctly.
    // This is more portable than passing literal non-printable characters in the format string.
    const format = options.format || '%H';
    const gitFormat = `%x1E%x1E%x1E%x1E${format}`;
    const args = ['log', `--format=${gitFormat}`];
    
    if (revisionRange) args.push(revisionRange);
    args.push('--relative');
    if (options.nameOnly) args.push('--name-only');
    if (options.additionalArgs) args.push(...options.additionalArgs);
    if (options.stdin !== undefined) args.push('--stdin');

    // Guard: Git log with empty stdin would output everything.
    if (options.stdin === '') return;

    const child = spawn('git', args, { cwd: this.cwd });

    if (options.stdin && child.stdin) {
        child.stdin.write(options.stdin);
        child.stdin.end();
    }

    if (!child.stdout) return;

    let buffer = '';
    for await (const chunk of child.stdout) {
        buffer += (chunk as Buffer | string).toString();
        const records = buffer.split(GIT_RECORD_SEP);
        
        // Final element is the partial record for next chunk
        buffer = records.pop() || '';

        for (const record of records) {
            if (record) yield record;
        }
    }

    if (buffer.trim()) {
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

  private parseBlameOutput(stdout: string): readonly BlameLine[] {
    if (!stdout.trim()) return [];
    const lines = stdout.split('\n');
    const results: BlameLine[] = [];
    let currentHash: string | null = null;
    let currentLineNumber: number | null = null;

    for (const line of lines) {
      const hashMatch = GitClient.BLAME_HASH_PATTERN.exec(line);
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
