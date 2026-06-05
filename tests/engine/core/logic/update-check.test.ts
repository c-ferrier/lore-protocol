import { checkForUpdates } from '../../../../src/engine/core/logic/update-check.js';
import { describe, it, expect } from 'vitest';

describe('Update Check (Logic)', () => {
  it('should not check for updates if CI is true', async () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv, CI: 'true' };
    const result = await checkForUpdates('0.0.0', 'atom-engine');
    expect(result).toBeUndefined();
    process.env = originalEnv;
  });
});
