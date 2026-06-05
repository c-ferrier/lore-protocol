import { createQueryTarget, createTargetFromIdentities, getCacheFingerprint, getGitBlameArgs, getGitLogArgs } from '../../../..//src/engine/core/logic/query-targets.js';

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
;

describe('Query Target Logic (Pure Functions)', () => {
  const context = {
    cwd: resolve('/work/project'),
    protocolRoot: resolve('/work/project'),
    isScoped: false
  };

  describe('createQueryTarget', () => {
    it('should create global target for empty input', () => {
      const target = createQueryTarget(undefined, context);
      expect(target.type).toBe('global');
      expect(target.resolvedPaths).toEqual([]);
    });

    it('should create scoped-global target if context.isScoped is true', () => {
        const scopedContext = { ...context, isScoped: true };
        const target = createQueryTarget(undefined, scopedContext);
        expect(target.type).toBe('global');
        expect(target.resolvedPaths).toEqual(['.']);
    });

    it('should parse line-range targets', () => {
      const target = createQueryTarget('src/utils.ts:45-80', context);
      expect(target.type).toBe('line-range');
      expect(target.lineRange).toEqual({
        file: 'src/utils.ts',
        start: 45,
        end: 80
      });
    });

    it('should handle single-line targets as ranges', () => {
      const target = createQueryTarget('src/utils.ts:45', context);
      expect(target.type).toBe('line-range');
      expect(target.lineRange?.start).toBe(45);
      expect(target.lineRange?.end).toBe(45);
    });

    it('should parse multi-path targets', () => {
        const target = createQueryTarget(['file1.ts', 'src/file2.ts'], context);
        expect(target.type).toBe('path');
        expect(target.resolvedPaths).toEqual(['file1.ts', 'src/file2.ts']);
    });
  });

  describe('getGitLogArgs', () => {
    it('should produce -- filePath for path targets', () => {
      const target = createQueryTarget('src/main.ts', context);
      expect(getGitLogArgs(target)).toEqual(['--', 'src/main.ts']);
    });

    it('should produce -L start,end:file for line-range targets', () => {
      const target = createQueryTarget('src/main.ts:10-20', context);
      expect(getGitLogArgs(target)).toEqual(['-L', '10,20:src/main.ts']);
    });

    it('should return empty for global targets', () => {
        const target = createQueryTarget(undefined, context);
        expect(getGitLogArgs(target)).toEqual([]);
    });
  });

  describe('getGitBlameArgs', () => {
    it('should return file, lineStart, lineEnd for line-range targets', () => {
      const target = createQueryTarget('src/main.ts:10-20', context);
      expect(getGitBlameArgs(target)).toEqual({
        file: 'src/main.ts',
        lineStart: 10,
        lineEnd: 20,
      });
    });

    it('should return file with lineStart=1 and lineEnd=-1 for other targets', () => {
      const target = createQueryTarget('src/main.ts', context);
      expect(getGitBlameArgs(target)).toEqual({
        file: 'src/main.ts',
        lineStart: 1,
        lineEnd: -1,
      });
    });
  });

  describe('getCacheFingerprint', () => {
    it('should produce stable fingerprints', () => {
        const t1 = createQueryTarget(['b.ts', 'a.ts'], context);
        const t2 = createQueryTarget(['a.ts', 'b.ts'], context);
        expect(getCacheFingerprint(t1)).toBe(getCacheFingerprint(t2));
        expect(getCacheFingerprint(t1)).toContain('path:a.ts,b.ts');
    });

    it('should handle identity targets', () => {
        const target = createTargetFromIdentities([{ protocol: 'mock', id: 'abc' }]);
        expect(getCacheFingerprint(target)).toBe('identity:mock/abc');
    });
  });
});