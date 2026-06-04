import { GitClient } from '../../../src/engine/shell/git/git-client.js';

import { describe, it, expect } from 'vitest';
;

describe('Git Log Combined Stream Parser (Logic)', () => {
  // Use a mock directory (not used for parsing)
  const client = new GitClient('/mock') as any;

  it('should correctly parse multiple commits with interleaved file lists using ASCII delimiters', () => {
    const FIELD_SEP = '\x1F';
    const RECORD_SEP = '\x1E';

    // Simulated Git output with Leader Separator and Trailing Field Delimiter
    // Chunk 1: Metadata + 2 files
    // Chunk 2: Metadata + 0 files
    // Chunk 3: Metadata + 1 file
    const rawOutput = [
      RECORD_SEP,
      ['h1', '2025-01-01', 'a1', 'subj1', 'body1', 'key1: v1'].join(FIELD_SEP),
      FIELD_SEP,
      '\nfile1.ts\nfile2.ts\n',
      RECORD_SEP,
      ['h2', '2025-01-02', 'a2', 'subj2', 'body2', 'key2: v2'].join(FIELD_SEP),
      FIELD_SEP,
      '\n',
      RECORD_SEP,
      ['h3', '2025-01-03', 'a3', 'subj3', 'body3', 'key3: v3'].join(FIELD_SEP),
      FIELD_SEP,
      '\nfile3.ts'
    ].join('');

    const commits = client.parseLogOutput(rawOutput);

    expect(commits).toHaveLength(3);

    expect(commits[0].hash).toBe('h1');
    expect(commits[0].filesChanged).toEqual(['file1.ts', 'file2.ts']);
    expect(commits[0].trailers).toBe('key1: v1');

    expect(commits[1].hash).toBe('h2');
    expect(commits[1].filesChanged).toEqual([]);
    expect(commits[1].trailers).toBe('key2: v2');

    expect(commits[2].hash).toBe('h3');
    expect(commits[2].filesChanged).toEqual(['file3.ts']);
  });

  it('should handle complex commit bodies with newlines and special characters', () => {
    const FIELD_SEP = '\x1F';
    const RECORD_SEP = '\x1E';

    const complexBody = 'This is a body\nwith multiple lines\nand some "special" symbols: !@#$%^&*()';
    const rawOutput = [
        RECORD_SEP,
        'h1', FIELD_SEP, 
        'date', FIELD_SEP, 
        'auth', FIELD_SEP, 
        'subj', FIELD_SEP, 
        complexBody, FIELD_SEP, 
        'Trailer: 1', FIELD_SEP,
        '\nfile1.ts\n'
    ].join('');

    const [commit] = client.parseLogOutput(rawOutput);
    expect(commit.body).toBe(complexBody);
    expect(commit.filesChanged).toEqual(['file1.ts']);
  });

  it('should return empty array for empty input', () => {
    expect(client.parseLogOutput('')).toEqual([]);
    expect(client.parseLogOutput('   ')).toEqual([]);
  });
});