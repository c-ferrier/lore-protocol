import { describe, it, expect } from 'vitest';
import { normalizePathToRoot } from '../../../../src/engine/core/logic/path-resolution.js';
import { ProtocolError } from '../../../../src/engine/util/errors.js';

describe('Path Resolution Logic (Pure Functions)', () => {
  const protocolRoot = '/work/project';
  const cwd = '/work/project/src';

  it('should normalize relative paths within the root', () => {
    expect(normalizePathToRoot('main.ts', cwd, protocolRoot)).toBe('src/main.ts');
    expect(normalizePathToRoot('./main.ts', cwd, protocolRoot)).toBe('src/main.ts');
  });

  it('should handle parent navigation within root', () => {
    expect(normalizePathToRoot('../package.json', cwd, protocolRoot)).toBe('package.json');
  });

  it('should throw error for paths outside the root', () => {
    expect(() => normalizePathToRoot('../../other-project', cwd, protocolRoot)).toThrow(ProtocolError);
    expect(() => normalizePathToRoot('/etc/passwd', cwd, protocolRoot)).toThrow(ProtocolError);
  });

  it('should preserve trailing slashes', () => {
    expect(normalizePathToRoot('subdir/', cwd, protocolRoot)).toBe('src/subdir/');
  });

  it('should return dot for the root itself', () => {
      expect(normalizePathToRoot('.', protocolRoot, protocolRoot)).toBe('.');
  });

  it('should normalize windows-style backslashes to POSIX', () => {
      // Logic uses rel.replace(/\\/g, '/')
      // Mocking backslashes in input (relative() usually handles this on POSIX but we verify the logic)
      expect(normalizePathToRoot('src\\file.ts', protocolRoot, protocolRoot)).toBe('src/file.ts');
  });
});
