import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkForUpdates } from '../../../../src/engine/util/update-check.js';
import updateNotifier from 'simple-update-notifier';

vi.mock('simple-update-notifier');

describe('Update Check Utility', () => {
  const originalEnv = process.env;
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
    // Ensure TTY for testing
    vi.stubGlobal('process', { ...process, stderr: { isTTY: true } });
  });

  afterEach(() => {
    process.env = originalEnv;
    process.argv = originalArgv;
    vi.unstubAllGlobals();
  });

  it('should call updateNotifier if enabled and in a TTY', async () => {
    await checkForUpdates({
      packageName: 'test-pkg',
      currentVersion: '1.0.0',
      configEnabled: true
    });

    expect(updateNotifier).toHaveBeenCalledWith(expect.objectContaining({
      pkg: { name: 'test-pkg', version: '1.0.0' }
    }));
  });

  it('should NOT call updateNotifier if disabled in config', async () => {
    await checkForUpdates({
      packageName: 'test-pkg',
      currentVersion: '1.0.0',
      configEnabled: false
    });

    expect(updateNotifier).not.toHaveBeenCalled();
  });

  it('should NOT call updateNotifier in CI', async () => {
    process.env.CI = 'true';
    await checkForUpdates({
      packageName: 'test-pkg',
      currentVersion: '1.0.0',
      configEnabled: true
    });

    expect(updateNotifier).not.toHaveBeenCalled();
  });

  it('should NOT call updateNotifier if --no-update-notifier flag is present', async () => {
    process.argv.push('--no-update-notifier');
    await checkForUpdates({
      packageName: 'test-pkg',
      currentVersion: '1.0.0',
      configEnabled: true
    });

    expect(updateNotifier).not.toHaveBeenCalled();
  });

  it('should NOT call updateNotifier if --json flag is present', async () => {
    process.argv.push('--json');
    await checkForUpdates({
      packageName: 'test-pkg',
      currentVersion: '1.0.0',
      configEnabled: true
    });

    expect(updateNotifier).not.toHaveBeenCalled();
  });
});
