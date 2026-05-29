import updateNotifier from 'simple-update-notifier';

/**
 * Performs a non-blocking check for package updates on npm.
 * 
 * DESIGN:
 * - Peeks at process.argv to allow early disabling before full parsing.
 * - Respects CI, TTY, and explicit environment variables.
 * - Requires explicit packageName to support forks and separate artifacts.
 */
export async function checkForUpdates(options: {
    packageName: string;
    currentVersion: string;
    configEnabled: boolean;
}): Promise<void> {
  const { packageName, currentVersion, configEnabled } = options;

  // 1. Environmental Blockers
  if (!process.stderr.isTTY) return;
  if (process.env['CI']) return;
  if (process.env['NO_UPDATE_NOTIFIER']) return;
  if (process.env['PROTOCOL_NO_UPDATE_CHECK']) return;

  // 2. Early CLI Argument Peek (pre-commander)
  const argv = process.argv;
  const isJson = argv.includes('--json') || 
                 argv.includes('--format=json') ||
                 (argv.indexOf('--format') !== -1 && argv[argv.indexOf('--format') + 1] === 'json');
  
  if (isJson) return;
  if (argv.includes('--no-update-notifier')) return;

  // 3. User Configuration Check
  if (!configEnabled) return;

  // 4. Perform Check (Non-blocking)
  try {
      updateNotifier({
          pkg: { name: packageName, version: currentVersion },
          updateCheckInterval: 1000 * 60 * 60 * 24 // 1 day
      });
  } catch {
      // Silently ignore network/npm errors to avoid blocking the CLI
  }
}
