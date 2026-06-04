import { makeStubGitClient, makeStubProtocol } from '../../../src/engine/testing.js';

import { describe, it, expect } from 'vitest';
;

describe('Testing Gateway Logic', () => {
  describe('makeStubProtocol', () => {
    it('should force lowercase name even if provided in overrides', () => {
      const stub = makeStubProtocol({ name: 'Alpha' });
      expect(stub.name).toBe('alpha');
    });

    it('should correctly capture storage namespace from a method', () => {
      const stub = makeStubProtocol({ getStorageNamespace: () => 'project' });
      expect(stub.storageNamespace).toBe('project');
      expect(stub.owns('project')).toBe(true);
    });

    it('should implement basic owns logic based on namespace', () => {
        const stub = makeStubProtocol({ name: 'Alpha', getStorageNamespace: () => 'ns' });
        // STRICT ISOLATION: Namespaced protocols only own their bucket.
        expect(stub.owns('alpha')).toBe(false);
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