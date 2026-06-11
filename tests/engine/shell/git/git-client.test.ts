import { execFile as execFileCb, spawn as spawnCb } from 'node:child_process';

import { beforeEach,describe, expect, it, vi } from 'vitest';

import { GIT_RECORD_SEP,GitClient } from '../../../../src/engine/shell/git/git-client.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

// Typed alias for the mocked execFile callback
type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

describe('GitClient Implementation', () => {
  const client = new GitClient('/test/cwd');

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getFilesChanged', () => {
    it('should correctly parse git diff-tree output', async () => {
      const hashes = ['aaaa111122223333444455556666777788889999', 'bbbb111122223333444455556666777788889999'];
      const mockOutput = `${hashes[0]}\nfile1.ts\nfile2.ts\n${hashes[1]}\nfile3.ts\n`;
      
      vi.mocked(execFileCb).mockImplementation(((cmd: string, args: string[], opts: Record<string, unknown>, callback: ExecFileCallback) => {
        callback(null, mockOutput, '');
      }) as unknown as typeof execFileCb);

      const result = await client.getFilesChanged(hashes);

      expect(result.get(hashes[0])).toEqual(['file1.ts', 'file2.ts']);
      expect(result.get(hashes[1])).toEqual(['file3.ts']);
    });

    it('should be robust against file paths that look like hashes', async () => {
      const hashes = ['aaaa111122223333444455556666777788889999'];
      // A file path that is exactly 40 chars and hexadecimal
      const sneakyPath = '1234567890123456789012345678901234567890'; 
      const mockOutput = `${hashes[0]}\n${sneakyPath}\nfile.ts\n`;

      vi.mocked(execFileCb).mockImplementation(((cmd: string, args: string[], opts: Record<string, unknown>, callback: ExecFileCallback) => {
        callback(null, mockOutput, '');
      }) as unknown as typeof execFileCb);

      const result = await client.getFilesChanged(hashes);

      // The sneaky path should be treated as a file, not a new commit
      expect(result.get(hashes[0])).toEqual([sneakyPath, 'file.ts']);
    });

    it('should return an empty map for empty input', async () => {
      const result = await client.getFilesChanged([]);
      expect(result.size).toBe(0);
      expect(execFileCb).not.toHaveBeenCalled();
    });
  });

  describe('query', () => {
      it('should construct correct git log flags for high-level filters', async () => {
          vi.mocked(execFileCb).mockImplementation(((cmd: string, args: string[], opts: Record<string, unknown>, callback: ExecFileCallback) => {
              callback(null, '', ''); // No output
          }) as unknown as typeof execFileCb);

          await client.query({
              author: 'Cole',
              sinceDate: new Date('2025-01-01'),
              maxCommits: 5,
              regexPatterns: [['(^Lore-id: )']],
              paths: ['src/']
          });

          const args = vi.mocked(execFileCb).mock.calls[0][1] as string[];
          expect(args).toContain('--author=Cole');
          expect(args).toContain('--since=2025-01-01T00:00:00.000Z');
          expect(args).toContain('--max-count=5');
          expect(args).toContain('--grep=(^Lore-id: )');
          expect(args).toContain('--extended-regexp');
          expect(args).toContain('--all-match');
          
          // Path separator
          const separatorIndex = args.indexOf('--');
          expect(separatorIndex).toBeGreaterThan(-1);
          expect(args[separatorIndex + 1]).toBe('src/');
      });

      it('should translate nested patterns into multiple --grep flags (AND of ORs)', async () => {
          vi.mocked(execFileCb).mockImplementation(((cmd: string, args: string[], opts: Record<string, unknown>, callback: ExecFileCallback) => {
              callback(null, '', '');
          }) as unknown as typeof execFileCb);

          await client.query({
              regexPatterns: [
                  ['(^Lore-id: )', '(^Fred-id: )'], // OR-set 1 (Discovery)
                  ['Confidence: high']              // AND-set 2 (Filter)
              ]
          });

          const args = vi.mocked(execFileCb).mock.calls[0][1] as string[];
          
          // Should have two separate grep flags
          const grepFlags = args.filter(a => a.startsWith('--grep='));
          expect(grepFlags).toHaveLength(2);
          
          // First flag should be the OR-set with parentheses
          expect(grepFlags).toContain('--grep=((^Lore-id: )|(^Fred-id: ))');
          
          // Second flag should be the simple pattern
          expect(grepFlags).toContain('--grep=Confidence: high');
          
          // Control flags must be present
          expect(args).toContain('--extended-regexp');
          expect(args).toContain('--all-match');
      });
  });

  describe('getLogStream', () => {
    it('should correctly parse streamed records across chunk boundaries', async () => {
        const mockStdout = (async function* () {
            yield Buffer.from(`${GIT_RECORD_SEP}h1\nfile1.ts\n`);
            yield Buffer.from(`file2.ts\n${GIT_RECORD_SEP}h2\n`);
            yield Buffer.from(`file3.ts\n`);
        })();

        // Cast to unknown then to ReturnType to provide a type-safe mock of ChildProcess
        // without using 'any', satisfying strict project lint rules.
        vi.mocked(spawnCb).mockReturnValue({
            stdout: mockStdout,
            on: vi.fn(),
            stderr: { on: vi.fn() },
            stdin: { write: vi.fn(), end: vi.fn() }
        } as unknown as ReturnType<typeof spawnCb>);

        const results = [];
        for await (const record of client.getLogStream('HEAD')) {
            results.push(record);
        }

        expect(results).toHaveLength(2);
        expect(results[0]).toBe('h1\nfile1.ts\nfile2.ts\n');
        expect(results[1]).toBe('h2\nfile3.ts\n');
        });

  });

  describe('Git Log Combined Stream Parser', () => {
    it('should correctly parse multiple commits with interleaved file lists using ASCII delimiters', () => {
      const FIELD_SEP = '\x1F';
      const RECORD_SEP = '\x1E\x1E\x1E\x1E';
  
      const rawOutput = [
        RECORD_SEP,
        ['h1', '2025-01-01', 'a1', 'subj1', 'body1', 'key1: v1'].join(FIELD_SEP),
        FIELD_SEP,
        '\nfile1.ts\nfile2.ts',
        RECORD_SEP,
        ['h2', '2025-01-02', 'a2', 'subj2', 'body2', 'key2: v2'].join(FIELD_SEP),
        FIELD_SEP,
        '\n',
        RECORD_SEP,
        ['h3', '2025-01-03', 'a3', 'subj3', 'body3', ''].join(FIELD_SEP),
        FIELD_SEP,
        '\nfile3.ts',
      ].join('');
  
      // Use unknown -> cast pattern to test internal private method
      const result = (client as unknown as { parseLogOutput: (o: string) => Array<{ hash: string; filesChanged: string[] }> }).parseLogOutput(rawOutput);
  
      expect(result).toHaveLength(3);
      expect(result[0].hash).toBe('h1');
      expect(result[0].filesChanged).toEqual(['file1.ts', 'file2.ts']);
      expect(result[1].hash).toBe('h2');
      expect(result[1].filesChanged).toEqual([]);
      expect(result[2].hash).toBe('h3');
      expect(result[2].filesChanged).toEqual(['file3.ts']);
    });
  });
});
