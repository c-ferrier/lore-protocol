/**
 * Returns the core Atom engine version for human display.
 * Includes build metadata (+timestamp.hash).
 */
export function getEngineVersion(fallback: string = '0.0.0-dev'): string {
  try {
    return __ATOM_VERSION__;
  } catch {
    return fallback;
  }
}

/**
 * Returns the PURE core engine version for machine logic (Update Checks).
 * Matches the version published to NPM.
 */
export function getEnginePublishedVersion(fallback: string = '0.0.0'): string {
  try {
    return __ATOM_PURE_VERSION__;
  } catch {
    return fallback;
  }
}

/**
 * Returns the package name for the core engine.
 */
export function getEnginePackageName(fallback: string = 'atom-engine'): string {
  try {
    return __ATOM_PACKAGE_NAME__;
  } catch {
    return fallback;
  }
}
