import { describe, it, expect } from 'vitest';
import { makeStubProtocol, makeStubGitClient } from '../../../src/engine/testing.js';

describe('Testing Gateway Logic', () => {
  describe('makeStubProtocol', () => {
    it('should force lowercase name even if provided in overrides', () => {
      const stub = makeStubProtocol({ name: 'Alpha' });
      expect(stub.name).toBe('alpha');
    });

    it('should correctly capture storage namespace from a method', () => {
      const stub = makeStubProtocol({ getStorageNamespace: () => 'project' });
      expect(stub.getStorageNamespace()).toBe('project');
      expect(stub.owns('project')).toBe(true);
    });

    it('should implement basic owns logic based on name and namespace', () => {
        const stub = makeStubProtocol({ name: 'Alpha', getStorageNamespace: () => 'ns' });
        expect(stub.owns('alpha')).toBe(true);
        expect(stub.owns('ns')).toBe(true);
        expect(stub.owns('other')).toBe(false);
    });
  });

  describe('makeStubGitClient', () => {
    it('should provide default values that satisfy standard tests', async () => {
      const stub = makeStubGitClient();
      await expect(stub.getRepoRoot()).resolves.toBe('/mock-repo');
      await expect(stub.resolveRef('HEAD')).resolves.toBe('head-hash');
    });

    it('should allow overriding specific methods while maintaining others', async () => {
      const stub = makeStubGitClient({
        resolveRef: async () => 'custom-hash'
      });
      expect(await stub.resolveRef('HEAD')).toBe('custom-hash');
      expect(await stub.getRepoRoot()).toBe('/mock-repo');
    });
  });
});
