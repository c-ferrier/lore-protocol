const TRAILER_LINE_PATTERN = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/;
const CONTINUATION_LINE_PATTERN = /^[ \t]+(.*)$/;

/**
 * Parses raw trailer text into structured trailer maps and serializes back.
 * Protocol-agnostic: does not authorize or normalize keys.
 *
 * GRASP: Information Expert -- knows trailer format rules.
 * SRP: Only parsing/serialization logic.
 */
export class TrailerParser {
  /**
   * Parse a raw trailer block (multi-line string) into a trailer map.
   * All values are stored as string arrays for uniformity.
   */
  parse(rawTrailers: string): Record<string, string[]> {
    const lines = rawTrailers.split('\n');
    const entries = this.parseLinesToEntries(lines);

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
  serialize(trailers: Record<string, readonly string[]>, authorizedKeys: string[] = []): string {
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
   * Extract the trailer block from a full commit message.
   * The trailer block is the last paragraph of the message -- separated from
   * the body by a blank line and containing at least one `Key: Value` line.
   */
  extractTrailerBlock(fullMessage: string): string {
    const trimmed = fullMessage.trimEnd();
    if (!trimmed) {
      return '';
    }

    // Split into paragraphs by blank lines
    const paragraphs = trimmed.split(/\n\n+/);
    if (paragraphs.length === 0) {
      return '';
    }

    // The trailer block is the last paragraph, if it contains trailers
    const lastParagraph = paragraphs[paragraphs.length - 1];
    const lines = lastParagraph.split('\n');

    // Check if this paragraph has at least one trailer line
    let hasTrailerLine = false;
    for (const line of lines) {
      if (TRAILER_LINE_PATTERN.test(line)) {
        hasTrailerLine = true;
        break;
      }
    }

    if (!hasTrailerLine) {
      return '';
    }

    // Verify all lines are either trailer lines or continuation lines
    for (const line of lines) {
      if (!TRAILER_LINE_PATTERN.test(line) && !CONTINUATION_LINE_PATTERN.test(line) && line.trim() !== '') {
        return '';
      }
    }

    return lastParagraph;
  }

  /**
   * Parse lines into key-value entries, handling continuation lines.
   * A continuation line (starting with whitespace) appends to the
   * previous trailer's value with a space separator.
   */
  private parseLinesToEntries(lines: string[]): readonly { key: string; value: string }[] {
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
}
