import { describe, expect,it } from 'vitest';

import { ownsKey } from '../../src/engine/core/logic/ownership.js';
import { makeStubProtocolContext,makeStubGitClient } from '../../src/engine/testing.js';

describe('Testing Gateway Logic', () => {
  describe('makeStubProtocolContext', () => {
    it('should force lowercase name even if provided in overrides', () => {
      const stub = makeStubProtocolContext({ name: 'Alpha' });
      expect(stub.name).toBe('alpha');
    });

    it('should correctly capture storage namespace', () => {
      const stub = makeStubProtocolContext({ namespace: 'project' });
      expect(stub.storageNamespace).toBe('project');
      expect(ownsKey('project', stub)).toBe(true);
    });

    it('should implement basic owns logic based on namespace', () => {
        const stub = makeStubProtocolContext({ name: 'Alpha', namespace: 'ns' });
        // STRICT ISOLATION: Namespaced protocols only own their bucket.
        expect(ownsKey('alpha', stub)).toBe(false);
        expect(ownsKey('ns', stub)).toBe(true);
        expect(ownsKey('other', stub)).toBe(false);
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
