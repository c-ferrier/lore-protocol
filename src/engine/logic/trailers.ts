import type { Trailers } from '../types/domain.js';

const TRAILER_LINE_PATTERN = /^([A-Za-z0-9][A-Za-z0-9-]*):\s*(.*)$/;
const CONTINUATION_LINE_PATTERN = /^[ \t]+(.*)$/;

/**
 * Parses raw trailer text into a structured trailer map.
 * All values are stored as string arrays for uniformity.
 */
export function parseTrailers(rawTrailers: string): Trailers {
  const lines = rawTrailers.split('\n');
  const entries = parseTrailerLinesToEntries(lines);

  const result: Record<string, string[]> = {};

  for (const { key, value } of entries) {
    const trimmedValue = value.trim();
    const existing = result[key] ?? [];
    existing.push(trimmedValue);
    result[key] = existing;
  }

  return result;
}

/**
 * Serialize trailers back into git trailer format.
 */
export function serializeTrailers(trailers: Trailers, authorizedKeys: string[] = []): string {
  const lines: string[] = [];
  const processed = new Set<string>();

  // Use provided order if possible
  const allKeys = Array.from(new Set([...authorizedKeys, ...Object.keys(trailers)]));

  for (const key of allKeys) {
    if (processed.has(key)) continue;
    processed.add(key);

    const values = trailers[key];
    if (!values || values.length === 0) continue;

    for (const value of values) {
      lines.push(`${key}: ${value}`);
    }
  }

  return lines.join('\n');
}

/**
 * Parse lines into key-value entries, handling continuation lines.
 * A continuation line (starting with whitespace) appends to the
 * previous trailer's value with a space separator.
 */
export function parseTrailerLinesToEntries(lines: string[]): readonly { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = [];

  for (const line of lines) {
    // Skip empty lines
    if (line.trim() === '') {
      continue;
    }

    // Check for continuation line first
    const continuationMatch = CONTINUATION_LINE_PATTERN.exec(line);
    if (continuationMatch && entries.length > 0) {
      const lastEntry = entries[entries.length - 1];
      lastEntry.value = `${lastEntry.value} ${continuationMatch[1]}`;
      continue;
    }

    // Check for trailer line
    const trailerMatch = TRAILER_LINE_PATTERN.exec(line);
    if (trailerMatch) {
      entries.push({ key: trailerMatch[1], value: trailerMatch[2] });
    }
  }
  return entries;
}
