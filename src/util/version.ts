import { execSync } from 'node:child_process';

/**
 * Returns the version string to display in the CLI.
 * In CI, returns the base version.
 * In development, appends build metadata (owner, branch, date, hash).
 */
export function getDisplayVersion(version: string): string {
  if (process.env.CI === 'true') {
    return version;
  }

  try {
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    // Dynamically resolve owner from 'personal' remote if it exists
    let owner = 'custom';
    try {
      const remoteUrl = execSync('git remote get-url personal', { encoding: 'utf-8' }).trim();
      // Match git@github.com:OWNER/repo.git or https://github.com/OWNER/repo.git
      const match = remoteUrl.match(/[:/]([^/]+)\/[^/]+(?:\.git)?$/);
      if (match) {
        owner = match[1];
      }
    } catch {
      // Fallback to 'custom' if 'personal' remote is missing
    }

    const suffix = branch ? `${owner}.${branch}` : owner;
    return `${version}-${suffix}.${date}.${hash}`;
  } catch {
    return version;
  }
}
