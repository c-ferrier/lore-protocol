import { GitClient } from '../../../../src/engine/shell/git/git-client.js';

import { describe, it, expect } from 'vitest';

describe('Git Log Combined Stream Parser (Logic)', () => {
  // Use a mock directory (not used for parsing)
  const client = new GitClient('/mock') as any;

  it('should correctly parse multiple commits with interleaved file lists using ASCII delimiters', () => {
    const FIELD_SEP = '\x1F';
    const RECORD_SEP = '\x1E';

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

    const result = (client as any).parseLogOutput(rawOutput);

    expect(result).toHaveLength(3);
    expect(result[0].hash).toBe('h1');
    expect(result[0].filesChanged).toEqual(['file1.ts', 'file2.ts']);
    expect(result[1].hash).toBe('h2');
    expect(result[1].filesChanged).toEqual([]);
    expect(result[2].hash).toBe('h3');
    expect(result[2].filesChanged).toEqual(['file3.ts']);
  });
});
