/**
 * Determines whether the CLI should check for updates.
 * Skips in CI, non-TTY, JSON output, or when explicitly disabled.
 *
 * Extracted from main.ts to avoid side-effect-on-import:
 * main.ts calls main() at the top level, so importing it
 * for this function would trigger the full CLI.
 */
export function shouldCheckForUpdate(configUpdateCheck: boolean): boolean {
  if (!process.stderr.isTTY) return false;

  const env = process.env;
  if (env['CI']) return false;
  if (env['NO_UPDATE_NOTIFIER']) return false;
  if (env['LORE_NO_UPDATE_CHECK']) return false;

  const argv = process.argv;
  if (argv.includes('--json') || argv.includes('--format=json')) return false;
  const formatIdx = argv.indexOf('--format');
  if (formatIdx !== -1 && argv[formatIdx + 1] === 'json') return false;
  if (argv.includes('--no-update-notifier')) return false;

  if (!configUpdateCheck) return false;

  return true;
}
