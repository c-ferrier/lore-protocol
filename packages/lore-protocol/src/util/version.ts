/**
 * Returns the Lore wrapper version for human display.
 * Includes compatibility prefix and build metadata (0.5.0-0.0.0+timestamp.hash).
 */
export function getLoreVersion(fallback: string = '0.0.0-dev'): string {
  try {
    return __LORE_VERSION__;
  } catch {
    return fallback;
  }
}

/**
 * Returns the PURE Lore wrapper version for machine logic (Update Checks).
 * Matches the version published to NPM (e.g. 0.0.0).
 */
export function getLorePublishedVersion(fallback: string = '0.0.0'): string {
  try {
    return __LORE_PURE_VERSION__;
  } catch {
    return fallback;
  }
}

/**
 * Returns the package name for the Lore wrapper.
 */
export function getLorePackageName(fallback: string = 'lore-protocol'): string {
  try {
    return __LORE_PACKAGE_NAME__;
  } catch {
    return fallback;
  }
}
