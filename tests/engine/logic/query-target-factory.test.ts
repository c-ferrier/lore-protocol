import { describe, it, expect } from 'vitest';
import { QueryTargetFactory } from '../../../src/engine/services/query-target-factory.js';

describe('QueryTargetFactory (Logic)', () => {
  describe('Global Targets', () => {
    it('should create a global target for undefined input', () => {
      const factory = new QueryTargetFactory({
        cwd: '/repo/subdir',
        protocolRoot: '/repo',
        isScoped: false
      });

      const target = factory.create();
      expect(target.type).toBe('global');
      expect(target.getPaths()).toEqual([]);
    });

    it('should create a scoped global target (dot) when isScoped is true', () => {
      const factory = new QueryTargetFactory({
        cwd: '/repo/subdir',
        protocolRoot: '/repo/subdir',
        isScoped: true
      });

      const target = factory.create();
      expect(target.type).toBe('global');
      expect(target.getPaths()).toEqual(['.']);
    });
  });

  describe('Path Resolution', () => {
    it('should resolve absolute paths relative to protocol root', () => {
      const factory = new QueryTargetFactory({
        cwd: '/repo/subdir',
        protocolRoot: '/repo',
        isScoped: false
      });

      // User provides absolute path within repo
      const target = factory.create('/repo/src/main.ts');
      expect(target.type).toBe('path');
      expect(target.getPaths()).toEqual(['src/main.ts']);
    });

    it('should resolve relative paths from CWD to protocol root', () => {
      const factory = new QueryTargetFactory({
        cwd: '/repo/src',
        protocolRoot: '/repo',
        isScoped: false
      });

      // User is in /repo/src and runs 'atom log main.ts'
      const target = factory.create('main.ts');
      expect(target.getPaths()).toEqual(['src/main.ts']);
    });

    it('should handle parent directory navigation (..)', () => {
        const factory = new QueryTargetFactory({
          cwd: '/repo/src/ui',
          protocolRoot: '/repo',
          isScoped: false
        });
  
        // User in /repo/src/ui runs 'atom log ../auth.ts'
        const target = factory.create('../auth.ts');
        expect(target.getPaths()).toEqual(['src/auth.ts']);
      });
  });

  describe('Line Range Parsing', () => {
    it('should parse simple line range (file:line)', () => {
      const factory = new QueryTargetFactory({
        cwd: '/repo',
        protocolRoot: '/repo',
        isScoped: false
      });

      const target = factory.create('src/main.ts:10');
      expect(target.type).toBe('line-range');
      expect(target.getPaths()).toEqual(['src/main.ts']);
      expect(target.getLineRange()).toEqual({
        file: 'src/main.ts',
        start: 10,
        end: 10
      });
      expect(target.isBlameTarget()).toBe(true);
    });

    it('should parse explicit range (file:start-end)', () => {
      const factory = new QueryTargetFactory({
        cwd: '/repo',
        protocolRoot: '/repo',
        isScoped: false
      });

      const target = factory.create('src/main.ts:10-20');
      expect(target.getLineRange()).toEqual({
        file: 'src/main.ts',
        start: 10,
        end: 20
      });
    });
  });

  describe('Multi-Path Targets', () => {
    it('should resolve multiple paths correctly', () => {
      const factory = new QueryTargetFactory({
        cwd: '/repo/src',
        protocolRoot: '/repo',
        isScoped: false
      });

      const target = factory.create(['main.ts', '../lib/utils.ts']);
      expect(target.type).toBe('path');
      expect(target.getPaths()).toEqual(['src/main.ts', 'lib/utils.ts']);
    });
  });

  describe('Security Boundaries', () => {
    it('should throw ProtocolError if path is outside protocol root', () => {
      const factory = new QueryTargetFactory({
        cwd: '/repo/src',
        protocolRoot: '/repo/src', // Scoped to src
        isScoped: true
      });

      // Attempt to escape src
      expect(() => factory.create('../package.json')).toThrow(/outside the protocol root/);
    });

    it('should throw ProtocolError for absolute paths outside protocol root', () => {
        const factory = new QueryTargetFactory({
          cwd: '/repo/src',
          protocolRoot: '/repo/src',
          isScoped: true
        });
  
        expect(() => factory.create('/etc/passwd')).toThrow(/outside the protocol root/);
      });
  });
});
