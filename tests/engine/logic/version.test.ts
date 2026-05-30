import { describe, it, expect } from 'vitest';
import { getEngineVersion } from '../../../src/engine/util/version.js';

describe('Version Utilities', () => {
  it('should return a default version in development mode', () => {
    const version = getEngineVersion();
    // Since __ATOM_VERSION__ is not defined during unit tests (Vitest doesn't run through tsup),
    // it should fall back to the default.
    expect(version).toBe('0.0.0-dev');
  });

  it('should allow providing a custom fallback', () => {
    const version = getEngineVersion('1.2.3');
    expect(version).toBe('1.2.3');
  });
});
