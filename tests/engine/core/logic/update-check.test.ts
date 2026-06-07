import { describe, expect,it } from 'vitest';

import { checkForUpdates } from '../../../../src/engine/core/logic/update-check.js';

describe('Update Check (Logic)', () => {
  it('should not check for updates if CI is true', async () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv, CI: 'true' };
    const result = await checkForUpdates({
        currentVersion: '0.0.0',
        packageName: 'atom-engine',
        configEnabled: true
    });
    expect(result).toBeUndefined();
    process.env = originalEnv;
  });
});
