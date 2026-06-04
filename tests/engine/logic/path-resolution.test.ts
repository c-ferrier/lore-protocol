import { normalizePathToRoot } from '../../../src/engine/core/logic/path-resolution.js';

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
;

describe('Path Resolution Logic (Pure Functions)', () => {
  const mockRoot = resolve('/work/project');
  const mockCwd = resolve('/work/project/src');

  describe('normalizePathToRoot', () => {
    it('should normalize CWD-relative file to root-relative', () => {
      const result = normalizePathToRoot('main.ts', mockCwd, mockRoot);
      expect(result).toBe('src/main.ts');
    });

    it('should handle parent directory references from CWD', () => {
      const result = normalizePathToRoot('../README.md', mockCwd, mockRoot);
      expect(result).toBe('README.md');
    });

    it('should handle absolute paths inside the root', () => {
      const absPath = resolve(mockRoot, 'package.json');
      const result = normalizePathToRoot(absPath, mockCwd, mockRoot);
      expect(result).toBe('package.json');
    });

    it('should throw error for paths outside the root', () => {
        expect(() => normalizePathToRoot('../../other/file.txt', mockCwd, mockRoot)).toThrow(/outside the protocol root/);
    });

    it('should preserve trailing slash for directory targeting', () => {
        const result = normalizePathToRoot('services/', mockCwd, mockRoot);
        expect(result).toBe('src/services/');
    });

    it('should return "." for the root itself', () => {
        const result = normalizePathToRoot('.', mockRoot, mockRoot);
        expect(result).toBe('.');
    });
  });
});