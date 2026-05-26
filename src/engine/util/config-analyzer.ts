/**
 * Configuration Drift and Gap Analysis Utility.
 * 
 * SOLID: SRP -- only responsible for comparing raw configuration state 
 * against expected schemas and defaults.
 */

export interface ConfigDiff {
  missing: string[];
  customized: string[];
}

/**
 * Compares a parsed user configuration against an expected schema.
 * 
 * @param parsedUserConfig The raw parsed TOML object from disk.
 * @param expectedSchema An object defining the expected sections and keys (e.g., Record<string, string[]>).
 * @param defaultValues An optional object containing baseline defaults for customization checking.
 * @returns An object containing arrays of missing keys and customized keys.
 */
export function analyzeConfigGaps(
  parsedUserConfig: Record<string, unknown>,
  expectedSchema: Record<string, string[]>,
  defaultValues: Record<string, any> = {}
): ConfigDiff {
  const missing: string[] = [];
  const customized: string[] = [];

  for (const [section, keys] of Object.entries(expectedSchema)) {
    const userSection = parsedUserConfig[section] as Record<string, unknown> | undefined;
    const defaultSection = defaultValues[section] || {};

    if (!userSection || typeof userSection !== 'object') {
      missing.push(`[${section}] section`);
      continue;
    }

    for (const key of keys) {
      // Check both snake_case (canonical TOML) and camelCase
      const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      const userValue = userSection[snakeKey] !== undefined ? userSection[snakeKey] : userSection[key];
      const defaultValue = defaultSection[key];

      if (userValue === undefined) {
        missing.push(`${section}.${snakeKey}`);
      } else if (defaultValue !== undefined && JSON.stringify(userValue) !== JSON.stringify(defaultValue)) {
        customized.push(`${section}.${snakeKey}`);
      }
    }
  }

  return { missing, customized };
}
