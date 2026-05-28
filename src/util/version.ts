/**
 * Returns the version string to display in the CLI.
 * 
 * DESIGN:
 * - Production builds (via tsup) inject a static LORE_VERSION string.
 * - Development/Tests fall back to the package version to avoid side effects.
 */
export function getDisplayVersion(version: string): string {
  // Injected by tsup define in production builds
  // @ts-ignore
  if (typeof LORE_VERSION !== 'undefined') {
    // @ts-ignore
    return LORE_VERSION;
  }

  return version;
}
