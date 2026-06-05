/**
 * Converts a string into a URL-safe or CLI-safe slug.
 * 
 * Logic:
 * 1. Lowercase the entire string.
 * 2. Replace all non-alphanumeric characters with the separator.
 * 3. Collapse multiple consecutive separators into one.
 * 4. Trim separators from the start and end.
 * 
 * Input: Any string (e.g. "My Trailer Key!", "Already-Kebab-Case")
 * Output: kebab-case string (e.g. "my-trailer-key", "already-kebab-case")
 */
export function slugify(text: string, separator = '-'): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, separator)
    .replace(new RegExp(`${separator}+`, 'g'), separator)
    .replace(new RegExp(`^${separator}|${separator}$`, 'g'), '');
}

/**
 * Converts a string to snake_case, suitable for JSON keys.
 * 
 * Logic:
 * 1. Insert an underscore between camelCase/PascalCase transitions (e.g. "myKey" -> "my_Key").
 * 2. Replace all non-alphanumeric characters (spaces, hyphens, etc.) with an underscore.
 * 3. Lowercase the entire string.
 * 4. Trim leading/trailing underscores and collapse consecutive ones.
 * 
 * Input: Any string (e.g. "ConfidenceLevel", "scope-risk", "My Trailer")
 * Output: snake_case string (e.g. "confidence_level", "scope_risk", "my_trailer")
 */
export function snakeCase(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1_$2') // Handle camelCase transitions
    .replace(/[^a-zA-Z0-9]+/g, '_')      // Replace non-alphanumeric with _
    .toLowerCase()
    .replace(/^_+|_+$/g, '')            // Trim leading/trailing underscores
    .replace(/_+/g, '_');               // Collapse multiple underscores
}

/**
 * Converts a kebab-case or space-separated string to camelCase.
 * 
 * Logic:
 * 1. Identify characters following a hyphen or space.
 * 2. Uppercase those characters and remove the separator.
 * 3. Lowercase the first character of the entire string.
 * 
 * Input: kebab-case or space-separated string (e.g. "scope-risk", "Assisted by")
 * Output: camelCase string (e.g. "scopeRisk", "assistedBy")
 */
export function camelCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-_ ]+([a-z0-9])/g, (_, char) => char.toUpperCase())
    .replace(/^([A-Z])/, (char) => char.toLowerCase());
}
